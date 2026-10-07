import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../../../../src/lib/database/database.js';
import { isPgError, PG_ERROR } from '../../../../src/lib/database/errors.js';
import { isInTransaction } from '../../../../src/lib/database/transaction-context.js';
import { InternalError } from '../../../../src/lib/error/errors.js';
import { PgTransactionManager } from '../../../../src/lib/transaction/transaction-manager.js';
import { createTestPool, silentLogger } from '../../support/test-database.js';

describe('PgTransactionManager', () => {
  let pool: Pool;
  let db: Database;
  let transactions: PgTransactionManager;

  const insert = (id: number, value = `v${id}`) =>
    db.query('INSERT INTO tx_probe (id, value) VALUES ($1, $2)', [id, value]);
  const ids = async () =>
    (await db.query<{ id: number }>('SELECT id FROM tx_probe ORDER BY id')).rows.map((r) => r.id);

  beforeAll(async () => {
    pool = createTestPool(3);
    db = new Database(pool);
    transactions = new PgTransactionManager(pool, silentLogger);
    await db.query(`
      DROP TABLE IF EXISTS tx_probe;
      CREATE TABLE tx_probe (id int PRIMARY KEY, value text NOT NULL);
    `);
  });

  beforeEach(async () => {
    await db.query('TRUNCATE tx_probe');
  });

  afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS tx_probe');
    await pool.end();
  });

  it('commits all writes and returns the callback result', async () => {
    const result = await transactions.run(async () => {
      await insert(1);
      await insert(2);
      return 'done';
    });

    expect(result).toBe('done');
    expect(await ids()).toEqual([1, 2]);
  });

  it('rolls back every write and rethrows the original error', async () => {
    const failure = new Error('business rule failed');

    const outcome = transactions.run(async () => {
      await insert(1);
      await insert(2);
      throw failure;
    });

    await expect(outcome).rejects.toBe(failure);
    expect(await ids()).toEqual([]);
  });

  it('rolls back when a statement fails', async () => {
    await expect(
      transactions.run(async () => {
        await insert(1);
        await insert(1); // duplicate key
      }),
    ).rejects.toSatisfy((err) => isPgError(err, PG_ERROR.UNIQUE_VIOLATION));

    expect(await ids()).toEqual([]);
  });

  it('runs every query of the transaction on one connection and one transaction', async () => {
    const seen = await transactions.run(async () => {
      const a = await db.query<{ pid: number; xid: string }>(
        'SELECT pg_backend_pid() AS pid, txid_current()::text AS xid',
      );
      await insert(1);
      const b = await db.query<{ pid: number; xid: string }>(
        'SELECT pg_backend_pid() AS pid, txid_current()::text AS xid',
      );
      return [a.rows[0], b.rows[0]];
    });

    expect(seen[0]).toEqual(seen[1]);
  });

  it('keeps uncommitted writes invisible to other connections', async () => {
    await transactions.run(async () => {
      await insert(1);
      const outside = await pool.query('SELECT count(*)::int AS n FROM tx_probe');
      expect(outside.rows[0]).toEqual({ n: 0 });
    });

    expect(await ids()).toEqual([1]);
  });

  it('reports whether code runs inside a transaction', async () => {
    expect(isInTransaction()).toBe(false);
    await transactions.run(async () => {
      expect(isInTransaction()).toBe(true);
    });
    expect(isInTransaction()).toBe(false);
  });

  describe('isolation levels', () => {
    it('defaults to read committed', async () => {
      const level = await transactions.run(
        async () => (await db.query('SHOW transaction_isolation')).rows[0],
      );

      expect(level).toEqual({ transaction_isolation: 'read committed' });
    });

    it.each(['repeatable read', 'serializable'] as const)('uses %s when requested', async (lvl) => {
      const level = await transactions.run(
        async () => (await db.query('SHOW transaction_isolation')).rows[0],
        { isolationLevel: lvl },
      );

      expect(level).toEqual({ transaction_isolation: lvl });
    });
  });

  describe('nesting', () => {
    it('joins the outer transaction, so an outer failure also undoes inner writes', async () => {
      await expect(
        transactions.run(async () => {
          await insert(1);
          await transactions.run(async () => {
            await insert(2);
          });
          throw new Error('outer fails after inner completed');
        }),
      ).rejects.toThrow('outer fails');

      expect(await ids()).toEqual([]);
    });

    it('commits inner and outer writes together', async () => {
      await transactions.run(async () => {
        await insert(1);
        await transactions.run(() => insert(2));
      });

      expect(await ids()).toEqual([1, 2]);
    });

    it('allows a nested call with the same isolation level', async () => {
      await transactions.run(
        () => transactions.run(() => insert(1), { isolationLevel: 'serializable' }),
        { isolationLevel: 'serializable' },
      );

      expect(await ids()).toEqual([1]);
    });

    it('refuses to join with a different isolation level', async () => {
      await expect(
        transactions.run(async () => {
          await transactions.run(() => insert(1), { isolationLevel: 'serializable' });
        }),
      ).rejects.toBeInstanceOf(InternalError);

      expect(await ids()).toEqual([]);
    });
  });

  it('fails instead of silently rolling back when a caught statement error aborted the transaction', async () => {
    const outcome = transactions.run(async () => {
      await insert(1);
      try {
        await insert(1); // fails and aborts the transaction
      } catch {
        // swallowed by mistake
      }
    });

    await expect(outcome).rejects.toThrow('Transaction was rolled back');
    expect(await ids()).toEqual([]);
  });

  it('isolates concurrent transactions from each other', async () => {
    const results = await Promise.allSettled([
      transactions.run(async () => {
        await insert(1);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await insert(2);
      }),
      transactions.run(async () => {
        await insert(10);
        throw new Error('second fails');
      }),
      transactions.run(async () => {
        await insert(20);
      }),
    ]);

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(await ids()).toEqual([1, 2, 20]);
  });

  it('returns connections to the pool after commits and rollbacks', async () => {
    for (let i = 0; i < 10; i++) {
      await transactions.run(() => insert(i)).catch(() => {});
      await transactions
        .run(async () => {
          throw new Error('rollback');
        })
        .catch(() => {});
    }

    expect(pool.totalCount).toBeLessThanOrEqual(3);
    expect(pool.idleCount).toBe(pool.totalCount);
    expect(pool.waitingCount).toBe(0);
  });

  it('does not leak connection error listeners across transactions', async () => {
    const client = await pool.connect();
    const baseline = client.listenerCount('error');
    client.release();

    for (let i = 0; i < 20; i++) {
      await transactions.run(() => db.query('SELECT 1'));
    }

    const reused = await pool.connect();
    expect(reused.listenerCount('error')).toBe(baseline);
    reused.release();
  });

  describe('work that outlives its transaction', () => {
    it('rejects queries issued after the transaction finished', async () => {
      let escaped: Promise<unknown> | undefined;

      await transactions.run(async () => {
        await insert(1);
        escaped = new Promise((resolve) => setTimeout(resolve, 20)).then(() => insert(2));
      });

      await expect(escaped).rejects.toThrow('Query issued after its transaction finished');
      expect(await ids()).toEqual([1]);
    });

    it('rejects starting a transaction from such work', async () => {
      let escaped: Promise<unknown> | undefined;

      await transactions.run(async () => {
        escaped = new Promise((resolve) => setTimeout(resolve, 20)).then(() =>
          transactions.run(() => insert(2)),
        );
      });

      await expect(escaped).rejects.toBeInstanceOf(InternalError);
      expect(await ids()).toEqual([]);
    });
  });

  it('discards a broken connection and keeps the pool usable', async () => {
    const outcome = transactions.run(async () => {
      await insert(1);
      const { rows } = await db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      // Kill this transaction's connection from another connection.
      await pool.query('SELECT pg_terminate_backend($1)', [rows[0]?.pid]);
      await insert(2);
    });

    await expect(outcome).rejects.toThrow();
    expect(await ids()).toEqual([]);
    await expect(transactions.run(() => insert(3))).resolves.toBeDefined();
    expect(await ids()).toEqual([3]);
  });
});
