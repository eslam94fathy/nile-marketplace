import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithCorrelationId } from '../../../../src/lib/correlation/correlation-context.js';
import { Database } from '../../../../src/lib/database/database.js';
import { type EventEnvelope, OutboxRelay } from '../../../../src/lib/events/outbox.relay.js';
import { PgOutboxWriter } from '../../../../src/lib/events/outbox.writer.js';
import { PgTransactionManager } from '../../../../src/lib/transaction/transaction-manager.js';
import { RabbitMqPublisher } from '../../../../src/pkg/messaging/rabbitmq-publisher.js';
import { captureMessages, TEST_RABBITMQ_URL } from '../../support/rabbitmq.js';
import { createTestPool, silentLogger } from '../../support/test-database.js';

const EXCHANGE = 'nile.events.e2e';
const SELLER_ID = '0199b3c4-0000-7000-8000-00000000c001';

describe('outbox end to end: transaction → outbox → relay → RabbitMQ', () => {
  let pool: Pool;
  let db: Database;
  let publisher: RabbitMqPublisher;

  beforeAll(async () => {
    pool = createTestPool();
    db = new Database(pool);
    await db.query('TRUNCATE outbox_events');
    publisher = new RabbitMqPublisher({
      url: TEST_RABBITMQ_URL,
      exchange: EXCHANGE,
      connectionName: 'nile-test',
    });
  });

  afterAll(async () => {
    await publisher.close();
    await db.query('TRUNCATE outbox_events');
    await pool.end();
  });

  it('delivers only events from committed transactions, with their correlation ID', async () => {
    const consumer = await captureMessages(EXCHANGE);
    const transactions = new PgTransactionManager(pool, silentLogger);
    const outbox = new PgOutboxWriter(db);
    const relay = new OutboxRelay(db, transactions, publisher, silentLogger, {
      batchSize: 10,
      maxAttempts: 5,
    });

    const committedId = await runWithCorrelationId('corr-e2e', () =>
      transactions.run(() =>
        outbox.append({
          aggregateType: 'seller',
          aggregateId: SELLER_ID,
          eventType: 'seller.approved',
          payload: { sellerId: SELLER_ID },
        }),
      ),
    );
    await transactions
      .run(async () => {
        await outbox.append({
          aggregateType: 'seller',
          aggregateId: SELLER_ID,
          eventType: 'seller.rejected',
          payload: { sellerId: SELLER_ID },
        });
        throw new Error('rolled back');
      })
      .catch(() => {});

    expect(await relay.relayBatch()).toEqual({ published: 1, failed: 0 });

    const [received] = await consumer.waitFor(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(consumer.messages).toHaveLength(1);
    expect(received?.properties).toMatchObject({
      messageId: committedId,
      correlationId: 'corr-e2e',
      type: 'seller.approved',
    });
    expect(JSON.parse(received?.content.toString() ?? '') as EventEnvelope).toMatchObject({
      id: committedId,
      type: 'seller.approved',
      aggregateType: 'seller',
      aggregateId: SELLER_ID,
      correlationId: 'corr-e2e',
      payload: { sellerId: SELLER_ID },
    });

    await consumer.close();
  });
});
