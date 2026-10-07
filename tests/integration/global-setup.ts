import pg from 'pg';
import { migrateTestDatabase } from './support/migrate.js';
import { TEST_DATABASE_URL } from './support/test-database.js';

/**
 * Runs once before the integration suite: makes sure the test database exists and is fully
 * migrated. Tests then only clean the tables they use.
 */
export default async function setup(): Promise<void> {
  try {
    await ensureTestDatabaseExists();
    await migrateTestDatabase();
  } catch (err) {
    throw new Error(
      'Integration tests need PostgreSQL, Redis and RabbitMQ. Start them with ' +
        '`docker compose up -d --wait` (see docker-compose.yml).',
      { cause: err },
    );
  }
}

/** The compose init script creates it on a fresh volume; this also covers older volumes. */
async function ensureTestDatabaseExists(): Promise<void> {
  const target = new URL(TEST_DATABASE_URL);
  const name = target.pathname.slice(1);
  const maintenance = new URL(TEST_DATABASE_URL);
  maintenance.pathname = '/postgres';

  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount === 0) {
      await client.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
    }
  } finally {
    await client.end();
  }
}
