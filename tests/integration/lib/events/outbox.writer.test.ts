import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runWithCorrelationId } from '../../../../src/lib/correlation/correlation-context.js';
import { Database } from '../../../../src/lib/database/database.js';
import { InternalError } from '../../../../src/lib/error/errors.js';
import { PgOutboxWriter } from '../../../../src/lib/events/outbox.writer.js';
import { PgTransactionManager } from '../../../../src/lib/transaction/transaction-manager.js';
import { createTestPool, silentLogger } from '../../support/test-database.js';

const SELLER_ID = '0199b3c4-0000-7000-8000-00000000a001';

describe('PgOutboxWriter', () => {
  let pool: Pool;
  let db: Database;
  let transactions: PgTransactionManager;
  let outbox: PgOutboxWriter;

  const sellerApproved = {
    aggregateType: 'seller',
    aggregateId: SELLER_ID,
    eventType: 'seller.approved',
    payload: { sellerId: SELLER_ID, approvedBy: 'admin-1' },
  };

  beforeAll(async () => {
    pool = createTestPool();
    db = new Database(pool);
    transactions = new PgTransactionManager(pool, silentLogger);
    outbox = new PgOutboxWriter(db);
  });

  beforeEach(async () => {
    await db.query('TRUNCATE outbox_events');
  });

  afterAll(async () => {
    await db.query('TRUNCATE outbox_events');
    await pool.end();
  });

  it('stores the event when the transaction commits', async () => {
    const id = await runWithCorrelationId('corr-outbox-1', () =>
      transactions.run(() => outbox.append(sellerApproved)),
    );

    const { rows } = await db.query('SELECT * FROM outbox_events');
    expect(rows).toEqual([
      expect.objectContaining({
        id,
        aggregate_type: 'seller',
        aggregate_id: SELLER_ID,
        event_type: 'seller.approved',
        payload: { sellerId: SELLER_ID, approvedBy: 'admin-1' },
        correlation_id: 'corr-outbox-1',
        published_at: null,
        attempts: 0,
        last_error: null,
      }),
    ]);
  });

  it('stores nothing when the transaction rolls back', async () => {
    await expect(
      transactions.run(async () => {
        await outbox.append(sellerApproved);
        throw new Error('business change failed');
      }),
    ).rejects.toThrow('business change failed');

    expect((await db.query('SELECT 1 FROM outbox_events')).rowCount).toBe(0);
  });

  it('refuses to append outside a transaction', async () => {
    await expect(outbox.append(sellerApproved)).rejects.toBeInstanceOf(InternalError);

    expect((await db.query('SELECT 1 FROM outbox_events')).rowCount).toBe(0);
  });

  it('stores payloads as JSON, including nested arrays and unicode', async () => {
    const payload = { items: [{ sku: 'A-1', qty: 2 }], note: 'قهوة ☕', nothing: null };

    await transactions.run(() => outbox.append({ ...sellerApproved, payload }));

    const { rows } = await db.query<{ payload: unknown; kind: string }>(
      'SELECT payload, jsonb_typeof(payload) AS kind FROM outbox_events',
    );
    expect(rows[0]).toEqual({ payload, kind: 'object' });
  });

  it('stores a null correlation ID outside a request context', async () => {
    await transactions.run(() => outbox.append(sellerApproved));

    const { rows } = await db.query('SELECT correlation_id FROM outbox_events');
    expect(rows[0]).toEqual({ correlation_id: null });
  });

  it.each(['SellerApproved', 'approved', 'seller.', 'seller approved', 'seller.approved;drop'])(
    'rejects the invalid event type %j',
    async (eventType) => {
      await expect(
        transactions.run(() => outbox.append({ ...sellerApproved, eventType })),
      ).rejects.toBeInstanceOf(InternalError);
    },
  );

  it('enforces the event type format in the database too', async () => {
    await expect(
      db.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('seller', $1, 'Not.Valid', '{}')`,
        [SELLER_ID],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
