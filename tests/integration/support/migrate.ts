import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { TEST_DATABASE_URL } from './test-database.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../src/migrations', import.meta.url));

/** Applies all pending real migrations to the test database. Idempotent. */
export async function migrateTestDatabase(): Promise<void> {
  await runner({
    databaseUrl: TEST_DATABASE_URL,
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    checkOrder: true,
    log: () => {},
  });
}
