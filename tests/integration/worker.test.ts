import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../../src/lib/config/config.schema.js';
import { runWithCorrelationId } from '../../src/lib/correlation/correlation-context.js';
import { Database } from '../../src/lib/database/database.js';
import { EVENTS_EXCHANGE } from '../../src/lib/events/outbox.relay.js';
import type { ReadinessReport } from '../../src/lib/health/health-check.js';
import { PgOutboxWriter } from '../../src/lib/events/outbox.writer.js';
import { PgTransactionManager } from '../../src/lib/transaction/transaction-manager.js';
import { type RunningWorker, startWorker } from '../../src/start-worker.js';
import { testConfig } from '../support/test-container.js';
import { migrateTestDatabase } from './support/migrate.js';
import { captureMessages } from './support/rabbitmq.js';
import { createTestPool, silentLogger } from './support/test-database.js';

const AGGREGATE_ID = '0199b3c4-0000-7000-8000-00000000e001';

/** Fast polling, an OS-assigned health port, and optional dependency overrides. */
function workerConfig(overrides: { rabbitmqUrl?: string } = {}): Config {
  return {
    ...testConfig,
    worker: { healthPort: 0 },
    outbox: { ...testConfig.outbox, pollIntervalMs: 50 },
    rabbitmq: { url: overrides.rabbitmqUrl ?? testConfig.rabbitmq.url },
  };
}

describe('worker', () => {
  let pool: Pool;
  let db: Database;
  let transactions: PgTransactionManager;
  let outbox: PgOutboxWriter;
  let worker: RunningWorker | undefined;
  let exit: ReturnType<typeof vi.fn<(code: number) => void>>;

  const appendEvent = (eventType: string) =>
    runWithCorrelationId('corr-worker', () =>
      transactions.run(() =>
        outbox.append({
          aggregateType: 'worker_test',
          aggregateId: AGGREGATE_ID,
          eventType,
          payload: { eventType },
        }),
      ),
    );

  const healthUrl = (path: string) =>
    `http://127.0.0.1:${(worker?.healthServer.address() as AddressInfo).port}${path}`;

  async function waitUntil(condition: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await condition())) {
      if (Date.now() > deadline) throw new Error('condition not met in time');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  beforeAll(async () => {
    await migrateTestDatabase();
    pool = createTestPool();
    db = new Database(pool);
    transactions = new PgTransactionManager(pool, silentLogger);
    outbox = new PgOutboxWriter(db);
  });

  beforeEach(async () => {
    await db.query('TRUNCATE outbox_events');
    exit = vi.fn<(code: number) => void>();
  });

  afterEach(async () => {
    await worker?.shutdown.shutdown('test cleanup');
    worker = undefined;
  });

  afterAll(async () => {
    await db.query('TRUNCATE outbox_events');
    await pool.end();
  });

  it('relays committed outbox events to RabbitMQ', async () => {
    const consumer = await captureMessages(EVENTS_EXCHANGE, 'worker_test.#');
    worker = await startWorker({ config: workerConfig(), exit });

    const eventId = await appendEvent('worker_test.relayed');

    const [message] = await consumer.waitFor(1);
    expect(message?.properties).toMatchObject({ messageId: eventId, correlationId: 'corr-worker' });
    await waitUntil(async () => {
      const { rows } = await db.query('SELECT published_at FROM outbox_events WHERE id = $1', [
        eventId,
      ]);
      return rows[0]?.published_at !== null;
    });
    await consumer.close();
  });

  it('drains a backlog larger than one batch', async () => {
    const consumer = await captureMessages(EVENTS_EXCHANGE, 'worker_test.#');
    for (let i = 0; i < 120; i++) await appendEvent('worker_test.backlog');

    worker = await startWorker({ config: workerConfig(), exit });

    await consumer.waitFor(120, 10_000);
    const { rows } = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM outbox_events WHERE published_at IS NULL',
    );
    expect(rows[0]?.n).toBe(0);
    await consumer.close();
  });

  it('serves liveness and readiness covering PostgreSQL and RabbitMQ', async () => {
    worker = await startWorker({ config: workerConfig(), exit });

    const live = await fetch(healthUrl('/health/live'));
    const ready = await fetch(healthUrl('/health/ready'));

    expect(live.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({
      status: 'ready',
      checks: {
        postgres: { status: 'up', latencyMs: expect.any(Number) },
        rabbitmq: { status: 'up', latencyMs: expect.any(Number) },
      },
    });
    expect((await fetch(healthUrl('/api/v1/anything'))).status).toBe(404);
  });

  it('keeps running when RabbitMQ is unreachable: not ready, events retried later', async () => {
    worker = await startWorker({
      config: workerConfig({ rabbitmqUrl: 'amqp://nile:nile@127.0.0.1:1' }),
      exit,
    });
    const eventId = await appendEvent('worker_test.pending');

    await waitUntil(async () => {
      const { rows } = await db.query<{ attempts: number }>(
        'SELECT attempts FROM outbox_events WHERE id = $1',
        [eventId],
      );
      return (rows[0]?.attempts ?? 0) > 0;
    });

    const ready = await fetch(healthUrl('/health/ready'));
    expect(ready.status).toBe(503);
    const report = (await ready.json()) as ReadinessReport;
    expect(report.checks.rabbitmq?.status).toBe('down');
    const { rows } = await db.query('SELECT published_at FROM outbox_events WHERE id = $1', [
      eventId,
    ]);
    expect(rows[0]?.published_at).toBeNull();
  });

  it('shuts down gracefully: stops polling, closes the health server and exits 0', async () => {
    worker = await startWorker({ config: workerConfig(), exit });
    const { healthServer } = worker;

    await worker.shutdown.shutdown('SIGTERM');

    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(healthServer.listening).toBe(false);

    // No relay runs after shutdown: a new event stays pending.
    const eventId = await appendEvent('worker_test.after_shutdown');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const { rows } = await db.query('SELECT published_at FROM outbox_events WHERE id = $1', [
      eventId,
    ]);
    expect(rows[0]?.published_at).toBeNull();
    worker = undefined;
  });
});
