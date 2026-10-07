import type { Pool } from 'pg';
import { createPool } from '../../../src/lib/database/pool.provider.js';
import { createLogger } from '../../../src/lib/logger/logger.js';

/** Integration tests always run against the dedicated test database (see docker-compose). */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://nile:nile@localhost:5432/nile_test';

export const silentLogger = createLogger({ name: 'test', level: 'silent', pretty: false });

export function createTestPool(poolMax = 2): Pool {
  return createPool({
    db: { url: TEST_DATABASE_URL, poolMax },
    applicationName: 'nile-test',
    logger: silentLogger,
  });
}
