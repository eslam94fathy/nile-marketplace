import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPool, TEST_DATABASE_URL } from '../../support/test-database.js';

const FIXTURE_DIR = fileURLToPath(new URL('../../../fixtures/migrations', import.meta.url));
// A dedicated tracking table keeps this test independent of the real migration history.
const MIGRATIONS_TABLE = 'pgmigrations_probe';

function migrate(direction: 'up' | 'down') {
  return runner({
    databaseUrl: TEST_DATABASE_URL,
    dir: FIXTURE_DIR,
    direction,
    migrationsTable: MIGRATIONS_TABLE,
    count: Infinity,
    checkOrder: true,
    log: () => {},
  });
}

describe('SQL migrations (node-pg-migrate)', () => {
  let pool: Pool;

  async function tableExists(name: string): Promise<boolean> {
    const result = await pool.query<{ exists: boolean }>(
      'SELECT to_regclass($1) IS NOT NULL AS exists',
      [name],
    );
    return result.rows[0]?.exists ?? false;
  }

  beforeAll(async () => {
    pool = createTestPool();
    await pool.query(`DROP TABLE IF EXISTS migration_probe, ${MIGRATIONS_TABLE}`);
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS migration_probe, ${MIGRATIONS_TABLE}`);
    await pool.end();
  });

  it('applies .sql migrations and records them', async () => {
    const applied = await migrate('up');

    expect(applied.map((m) => m.name)).toEqual(['1759800000000_create-migration-probe']);
    expect(await tableExists('migration_probe')).toBe(true);
    const recorded = await pool.query(`SELECT name FROM ${MIGRATIONS_TABLE}`);
    expect(recorded.rows).toEqual([{ name: '1759800000000_create-migration-probe' }]);
  });

  it('is idempotent when run again', async () => {
    expect(await migrate('up')).toEqual([]);
  });

  it('applies constraints and defaults from the migration', async () => {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO migration_probe (name) VALUES ('first') RETURNING id`,
    );
    expect(inserted.rows[0]?.id).toEqual(expect.any(String));

    await expect(
      pool.query(`INSERT INTO migration_probe (name) VALUES ('first')`),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rolls migrations back', async () => {
    const reverted = await migrate('down');

    expect(reverted.map((m) => m.name)).toEqual(['1759800000000_create-migration-probe']);
    expect(await tableExists('migration_probe')).toBe(false);
    const recorded = await pool.query(`SELECT count(*)::int AS n FROM ${MIGRATIONS_TABLE}`);
    expect(recorded.rows[0]).toEqual({ n: 0 });
  });
});
