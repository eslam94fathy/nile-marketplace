import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type AuditEntry, PgAuditLogger } from '../../../../src/lib/audit/audit.logger.js';
import { runWithCorrelationId } from '../../../../src/lib/correlation/correlation-context.js';
import { Database } from '../../../../src/lib/database/database.js';
import { InternalError } from '../../../../src/lib/error/errors.js';
import { PgTransactionManager } from '../../../../src/lib/transaction/transaction-manager.js';
import { migrateTestDatabase } from '../../support/migrate.js';
import { createTestPool, silentLogger } from '../../support/test-database.js';

const ADMIN_ID = '0199b3c4-0000-7000-8000-00000000d001';
const SELLER_ID = '0199b3c4-0000-7000-8000-00000000d002';

const sellerApproved: AuditEntry = {
  actor: { type: 'user', id: ADMIN_ID },
  action: 'seller.approved',
  entity: { type: 'seller', id: SELLER_ID },
  metadata: { previousStatus: 'PENDING_APPROVAL', newStatus: 'APPROVED' },
};

describe('PgAuditLogger', () => {
  let pool: Pool;
  let db: Database;
  let transactions: PgTransactionManager;
  let audit: PgAuditLogger;

  const count = async () =>
    (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_logs')).rows[0]?.n;

  beforeAll(async () => {
    await migrateTestDatabase();
    pool = createTestPool();
    db = new Database(pool);
    transactions = new PgTransactionManager(pool, silentLogger);
    audit = new PgAuditLogger(db);
  });

  beforeEach(async () => {
    await db.query('TRUNCATE audit_logs');
  });

  afterAll(async () => {
    await db.query('TRUNCATE audit_logs');
    await pool.end();
  });

  it('records who did what to which entity, with the correlation ID', async () => {
    const id = await runWithCorrelationId('corr-audit-1', () => audit.record(sellerApproved));

    const { rows } = await db.query('SELECT * FROM audit_logs');
    expect(rows).toEqual([
      {
        id,
        actor_type: 'user',
        actor_id: ADMIN_ID,
        action: 'seller.approved',
        entity_type: 'seller',
        entity_id: SELLER_ID,
        metadata: { previousStatus: 'PENDING_APPROVAL', newStatus: 'APPROVED' },
        correlation_id: 'corr-audit-1',
        created_at: expect.any(Date),
      },
    ]);
  });

  it('records system and anonymous actors without an actor id', async () => {
    await audit.record({ actor: { type: 'system' }, action: 'outbox.event_abandoned' });
    await audit.record({
      actor: { type: 'anonymous' },
      action: 'auth.login_failed',
      metadata: { reason: 'invalid_credentials' },
    });

    const { rows } = await db.query(
      'SELECT actor_type, actor_id, entity_type, entity_id, metadata FROM audit_logs ORDER BY id',
    );
    expect(rows).toEqual([
      { actor_type: 'system', actor_id: null, entity_type: null, entity_id: null, metadata: {} },
      {
        actor_type: 'anonymous',
        actor_id: null,
        entity_type: null,
        entity_id: null,
        metadata: { reason: 'invalid_credentials' },
      },
    ]);
  });

  describe('transactions', () => {
    it('commits with the business change', async () => {
      await transactions.run(() => audit.record(sellerApproved));

      expect(await count()).toBe(1);
    });

    it('rolls back with the business change', async () => {
      await expect(
        transactions.run(async () => {
          await audit.record(sellerApproved);
          throw new Error('approval failed');
        }),
      ).rejects.toThrow('approval failed');

      expect(await count()).toBe(0);
    });

    it('persists records written outside a transaction (e.g. failures)', async () => {
      await expect(
        transactions.run(async () => {
          throw new Error('login failed');
        }),
      ).rejects.toThrow();
      await audit.record({ actor: { type: 'anonymous' }, action: 'auth.login_failed' });

      expect(await count()).toBe(1);
    });
  });

  describe('append-only', () => {
    it('rejects UPDATE at the database level', async () => {
      await audit.record(sellerApproved);

      await expect(db.query(`UPDATE audit_logs SET action = 'seller.rejected'`)).rejects.toThrow(
        'audit_logs is append-only (UPDATE is not allowed)',
      );
      expect((await db.query('SELECT action FROM audit_logs')).rows).toEqual([
        { action: 'seller.approved' },
      ]);
    });

    it('rejects DELETE at the database level', async () => {
      await audit.record(sellerApproved);

      await expect(db.query('DELETE FROM audit_logs')).rejects.toThrow(
        'audit_logs is append-only (DELETE is not allowed)',
      );
      expect(await count()).toBe(1);
    });

    it('exposes no update or delete methods', () => {
      expect(Object.getOwnPropertyNames(PgAuditLogger.prototype).sort()).toEqual([
        'constructor',
        'record',
      ]);
    });
  });

  describe('sensitive metadata', () => {
    it.each([
      ['top-level password', { password: 'hunter2' }, 'metadata.password'],
      ['snake_case refresh token', { refresh_token: 'abc' }, 'metadata.refresh_token'],
      ['mixed-case key', { AccessToken: 'abc' }, 'metadata.AccessToken'],
      [
        'nested secret',
        { request: { headers: { Authorization: 'Bearer x' } } },
        'metadata.request.headers.Authorization',
      ],
      [
        'inside an array',
        { attempts: [{ ok: true }, { cardNumber: '4111' }] },
        'metadata.attempts[1].cardNumber',
      ],
    ])('rejects %s', async (_label, metadata, path) => {
      const outcome = audit.record({ ...sellerApproved, metadata });

      await expect(outcome).rejects.toBeInstanceOf(InternalError);
      await expect(outcome).rejects.toThrow(path);
      expect(await count()).toBe(0);
    });

    it('allows ordinary keys that merely contain sensitive words', async () => {
      await audit.record({
        ...sellerApproved,
        metadata: { tokenExpiresAt: '2026-10-07', passwordChanged: true, secretariat: 'x' },
      });

      expect(await count()).toBe(1);
    });
  });

  describe('validation', () => {
    it.each(['SellerApproved', 'approved', 'seller approved'])(
      'rejects the invalid action %j',
      async (action) => {
        await expect(audit.record({ ...sellerApproved, action })).rejects.toBeInstanceOf(
          InternalError,
        );
      },
    );

    it('enforces actor and entity consistency in the database', async () => {
      await expect(
        db.query(`INSERT INTO audit_logs (actor_type, action) VALUES ('user', 'seller.approved')`),
      ).rejects.toMatchObject({ code: '23514', constraint: 'audit_logs_actor_check' });
      await expect(
        db.query(
          `INSERT INTO audit_logs (actor_type, action, entity_type) VALUES ('system', 'a.b', 'seller')`,
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'audit_logs_entity_check' });
      await expect(
        db.query(
          `INSERT INTO audit_logs (actor_type, action, metadata) VALUES ('system', 'a.b', '[]')`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});
