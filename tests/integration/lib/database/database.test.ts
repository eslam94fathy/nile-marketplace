import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../../../../src/lib/database/database.js';
import { isPgError, PG_ERROR, violatesConstraint } from '../../../../src/lib/database/errors.js';
import { createTestPool } from '../../support/test-database.js';

describe('Database (PostgreSQL)', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(async () => {
    // Regular tables, not TEMP: pg discards a pooled connection after a failed query, so
    // session-scoped tables would disappear between the error-detection tests.
    pool = createTestPool();
    db = new Database(pool);

    await db.query(`
      DROP TABLE IF EXISTS db_test_child, db_test_parent;
      CREATE TABLE db_test_parent (id int PRIMARY KEY);
      CREATE TABLE db_test_child (
        id int PRIMARY KEY,
        email text NOT NULL CONSTRAINT db_test_child_email_key UNIQUE,
        quantity int NOT NULL CONSTRAINT db_test_child_quantity_check CHECK (quantity >= 0),
        parent_id int CONSTRAINT db_test_child_parent_fk REFERENCES db_test_parent (id)
      );
      INSERT INTO db_test_parent (id) VALUES (1);
      INSERT INTO db_test_child (id, email, quantity, parent_id) VALUES (1, 'a@example.com', 1, 1);
    `);
  });

  afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS db_test_child, db_test_parent');
    await pool.end();
  });

  it('runs SELECT 1', async () => {
    const result = await db.query<{ ok: number }>('SELECT 1 AS ok');

    expect(result.rows).toEqual([{ ok: 1 }]);
  });

  it('binds parameters instead of interpolating them', async () => {
    const hostile = "x'); DROP TABLE db_test_child; --";

    const result = await db.query<{ value: string }>('SELECT $1::text AS value', [hostile]);

    expect(result.rows[0]?.value).toBe(hostile);
    expect((await db.query('SELECT count(*)::int AS n FROM db_test_child')).rows[0]).toEqual({
      n: 1,
    });
  });

  it('reports rowCount for writes', async () => {
    const result = await db.query(
      'UPDATE db_test_child SET quantity = quantity WHERE id = $1',
      [1],
    );

    expect(result.rowCount).toBe(1);
  });

  it('runs on PostgreSQL 18 with uuidv7() available', async () => {
    const result = await db.query<{ version: number; id: string }>(
      `SELECT current_setting('server_version_num')::int AS version, uuidv7()::text AS id`,
    );

    expect(result.rows[0]?.version).toBeGreaterThanOrEqual(180000);
    expect(result.rows[0]?.id).toMatch(/^[0-9a-f-]{14}7/);
  });

  it('applies pool session settings', async () => {
    const result = await db.query<{ app: string; timeout: string; idle: string }>(`
      SELECT current_setting('application_name') AS app,
             current_setting('statement_timeout') AS timeout,
             current_setting('idle_in_transaction_session_timeout') AS idle
    `);

    expect(result.rows[0]).toEqual({ app: 'nile-test', timeout: '30s', idle: '1min' });
  });

  describe('error detection', () => {
    async function errorFrom(sql: string): Promise<unknown> {
      try {
        await db.query(sql);
      } catch (err) {
        return err;
      }
      throw new Error('expected query to fail');
    }

    it('detects a unique violation and its constraint', async () => {
      const err = await errorFrom(
        `INSERT INTO db_test_child (id, email, quantity) VALUES (2, 'a@example.com', 1)`,
      );

      expect(isPgError(err, PG_ERROR.UNIQUE_VIOLATION)).toBe(true);
      expect(violatesConstraint(err, 'db_test_child_email_key')).toBe(true);
      expect(violatesConstraint(err, 'other_constraint')).toBe(false);
    });

    it('detects a foreign key violation', async () => {
      const err = await errorFrom(
        `INSERT INTO db_test_child (id, email, quantity, parent_id) VALUES (3, 'b@example.com', 1, 999)`,
      );

      expect(isPgError(err, PG_ERROR.FOREIGN_KEY_VIOLATION)).toBe(true);
      expect(violatesConstraint(err, 'db_test_child_parent_fk')).toBe(true);
    });

    it('detects a check violation', async () => {
      const err = await errorFrom(
        `INSERT INTO db_test_child (id, email, quantity) VALUES (4, 'c@example.com', -1)`,
      );

      expect(isPgError(err, PG_ERROR.CHECK_VIOLATION)).toBe(true);
      expect(violatesConstraint(err, 'db_test_child_quantity_check')).toBe(true);
    });

    it('detects a not-null violation', async () => {
      const err = await errorFrom(`INSERT INTO db_test_child (id, quantity) VALUES (5, 1)`);

      expect(isPgError(err, PG_ERROR.NOT_NULL_VIOLATION)).toBe(true);
    });

    it('distinguishes codes', async () => {
      const err = await errorFrom(
        `INSERT INTO db_test_child (id, email, quantity) VALUES (6, 'd@example.com', -1)`,
      );

      expect(isPgError(err)).toBe(true);
      expect(isPgError(err, PG_ERROR.UNIQUE_VIOLATION)).toBe(false);
    });

    it('does not treat non-database errors as PostgreSQL errors', () => {
      expect(isPgError(new Error('boom'))).toBe(false);
      expect(isPgError({ code: '23505' })).toBe(false);
      expect(violatesConstraint(undefined, 'db_test_child_email_key')).toBe(false);
    });
  });
});
