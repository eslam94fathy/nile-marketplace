import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  getCorrelationId,
  runWithCorrelationId,
} from '../../../../src/lib/correlation/correlation-context.js';
import { Database } from '../../../../src/lib/database/database.js';
import { type EventEnvelope, OutboxRelay } from '../../../../src/lib/events/outbox.relay.js';
import { PgOutboxWriter } from '../../../../src/lib/events/outbox.writer.js';
import { PgTransactionManager } from '../../../../src/lib/transaction/transaction-manager.js';
import type {
  MessagePublisher,
  OutgoingMessage,
} from '../../../../src/pkg/messaging/message-publisher.js';
import { captureLogger } from '../../../support/capture-logger.js';
import { createTestPool, silentLogger } from '../../support/test-database.js';

/** Records published messages; can be told to fail or delay specific event types. */
class FakePublisher implements MessagePublisher {
  readonly published: OutgoingMessage[] = [];
  readonly correlationIdsSeen: (string | undefined)[] = [];
  failTypes = new Set<string>();
  delayMs = 0;

  async publish(message: OutgoingMessage): Promise<void> {
    this.correlationIdsSeen.push(getCorrelationId());
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failTypes.has(message.type)) throw new Error(`broker rejected ${message.type}`);
    this.published.push(message);
  }
  async ping(): Promise<void> {}
  async close(): Promise<void> {}
}

const AGGREGATE_ID = '0199b3c4-0000-7000-8000-00000000b001';

describe('OutboxRelay', () => {
  let pool: Pool;
  let db: Database;
  let transactions: PgTransactionManager;
  let outbox: PgOutboxWriter;
  let publisher: FakePublisher;

  const relay = (
    options: { batchSize?: number; maxAttempts?: number } = {},
    logger = silentLogger,
  ) =>
    new OutboxRelay(db, transactions, publisher, logger, {
      batchSize: options.batchSize ?? 50,
      maxAttempts: options.maxAttempts ?? 5,
    });

  const append = (eventType: string, correlationId = 'corr-relay') =>
    runWithCorrelationId(correlationId, () =>
      transactions.run(() =>
        outbox.append({
          aggregateType: 'order',
          aggregateId: AGGREGATE_ID,
          eventType,
          payload: { eventType },
        }),
      ),
    );

  const rows = async () =>
    (
      await db.query<{
        event_type: string;
        published: boolean;
        attempts: number;
        last_error: string | null;
        retry_in_seconds: number;
      }>(
        `SELECT event_type, published_at IS NOT NULL AS published, attempts, last_error,
                round(extract(epoch from next_attempt_at - now()))::int AS retry_in_seconds
         FROM outbox_events ORDER BY id`,
      )
    ).rows;

  beforeAll(async () => {
    pool = createTestPool(5);
    db = new Database(pool);
    transactions = new PgTransactionManager(pool, silentLogger);
    outbox = new PgOutboxWriter(db);
  });

  beforeEach(async () => {
    await db.query('TRUNCATE outbox_events');
    publisher = new FakePublisher();
  });

  afterAll(async () => {
    await db.query('TRUNCATE outbox_events');
    await pool.end();
  });

  it('does nothing when there are no pending events', async () => {
    expect(await relay().relayBatch()).toEqual({ published: 0, failed: 0 });
  });

  it('publishes pending events in creation order and marks them published', async () => {
    const firstId = await append('order.created');
    await append('order.paid');
    await append('order.shipped');

    const result = await relay().relayBatch();

    expect(result).toEqual({ published: 3, failed: 0 });
    expect(publisher.published.map((m) => m.type)).toEqual([
      'order.created',
      'order.paid',
      'order.shipped',
    ]);
    expect((await rows()).every((row) => row.published)).toBe(true);

    const first = publisher.published[0];
    expect(first).toMatchObject({
      id: firstId,
      routingKey: 'order.created',
      correlationId: 'corr-relay',
      headers: { 'x-aggregate-type': 'order', 'x-aggregate-id': AGGREGATE_ID },
    });
    expect(first?.body).toEqual<EventEnvelope>({
      id: firstId,
      type: 'order.created',
      aggregateType: 'order',
      aggregateId: AGGREGATE_ID,
      occurredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      correlationId: 'corr-relay',
      payload: { eventType: 'order.created' },
    });
  });

  it('does not publish an event twice', async () => {
    await append('order.created');

    await relay().relayBatch();
    const second = await relay().relayBatch();

    expect(second).toEqual({ published: 0, failed: 0 });
    expect(publisher.published).toHaveLength(1);
  });

  it('respects the batch size', async () => {
    for (let i = 0; i < 5; i++) await append('order.created');

    expect(await relay({ batchSize: 2 }).relayBatch()).toEqual({ published: 2, failed: 0 });
    expect(await relay({ batchSize: 2 }).relayBatch()).toEqual({ published: 2, failed: 0 });
    expect(await relay({ batchSize: 2 }).relayBatch()).toEqual({ published: 1, failed: 0 });
  });

  it('publishes with the correlation ID of the request that produced the event', async () => {
    await append('order.created', 'corr-a');
    await append('order.paid', 'corr-b');

    await relay().relayBatch();

    expect(publisher.correlationIdsSeen).toEqual(['corr-a', 'corr-b']);
  });

  describe('failures', () => {
    it('schedules a retry with backoff while still publishing the rest of the batch', async () => {
      await append('order.created');
      await append('order.paid');
      publisher.failTypes.add('order.paid');

      const result = await relay().relayBatch();

      expect(result).toEqual({ published: 1, failed: 1 });
      expect(await rows()).toEqual([
        expect.objectContaining({ event_type: 'order.created', published: true, attempts: 0 }),
        expect.objectContaining({
          event_type: 'order.paid',
          published: false,
          attempts: 1,
          last_error: 'broker rejected order.paid',
          retry_in_seconds: 2,
        }),
      ]);
    });

    it('does not retry before the backoff has elapsed', async () => {
      await append('order.paid');
      publisher.failTypes.add('order.paid');
      await relay().relayBatch();
      publisher.failTypes.clear();

      expect(await relay().relayBatch()).toEqual({ published: 0, failed: 0 });

      await db.query('UPDATE outbox_events SET next_attempt_at = now()');
      expect(await relay().relayBatch()).toEqual({ published: 1, failed: 0 });
    });

    it('doubles the backoff on each failure, capped at 5 minutes', async () => {
      await append('order.paid');
      publisher.failTypes.add('order.paid');
      const delays: number[] = [];

      for (let attempt = 0; attempt < 10; attempt++) {
        await db.query('UPDATE outbox_events SET next_attempt_at = now()');
        await relay({ maxAttempts: 100 }).relayBatch();
        delays.push((await rows())[0]?.retry_in_seconds ?? -1);
      }

      expect(delays).toEqual([2, 4, 8, 16, 32, 64, 128, 256, 300, 300]);
    });

    it('stops retrying after maxAttempts and logs an error', async () => {
      const { logger, lines } = captureLogger();
      await append('order.paid');
      publisher.failTypes.add('order.paid');

      for (let attempt = 0; attempt < 3; attempt++) {
        await db.query('UPDATE outbox_events SET next_attempt_at = now()');
        await relay({ maxAttempts: 3 }, logger).relayBatch();
      }
      await db.query('UPDATE outbox_events SET next_attempt_at = now()');
      publisher.failTypes.clear();

      expect(await relay({ maxAttempts: 3 }, logger).relayBatch()).toEqual({
        published: 0,
        failed: 0,
      });
      expect((await rows())[0]).toMatchObject({ attempts: 3, published: false });
      expect(lines.filter((l) => l.level === 'warn')).toHaveLength(2);
      expect(lines.filter((l) => l.level === 'error')).toEqual([
        expect.objectContaining({
          msg: 'Outbox event exhausted its publish attempts; giving up',
          correlationId: 'corr-relay',
        }),
      ]);
    });
  });

  it('never publishes the same event from concurrent relays', async () => {
    for (let i = 0; i < 20; i++) await append('order.created');
    publisher.delayMs = 30;

    const results = await Promise.all([
      relay({ batchSize: 5 }).relayBatch(),
      relay({ batchSize: 5 }).relayBatch(),
      relay({ batchSize: 5 }).relayBatch(),
      relay({ batchSize: 5 }).relayBatch(),
    ]);

    const ids = publisher.published.map((m) => m.id);
    expect(results.reduce((sum, r) => sum + r.published, 0)).toBe(20);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rolls back the batch (to be republished) if marking it published fails', async () => {
    await append('order.created');
    // Break the UPDATE that marks events published, after publishing succeeded.
    await db.query(`
      CREATE OR REPLACE FUNCTION fail_publish_mark() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated failure while marking published'; END $$;
      CREATE TRIGGER fail_publish_mark BEFORE UPDATE OF published_at ON outbox_events
      FOR EACH ROW EXECUTE FUNCTION fail_publish_mark();
    `);

    try {
      await expect(relay().relayBatch()).rejects.toThrow('simulated failure');
    } finally {
      await db.query(`
        DROP TRIGGER fail_publish_mark ON outbox_events;
        DROP FUNCTION fail_publish_mark();
      `);
    }

    // At-least-once: the event was published but is still pending, so it is published again.
    expect(await relay().relayBatch()).toEqual({ published: 1, failed: 0 });
    expect(publisher.published).toHaveLength(2);
    expect(publisher.published[0]?.id).toBe(publisher.published[1]?.id);
  });
});
