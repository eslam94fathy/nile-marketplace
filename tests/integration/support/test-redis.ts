import type { Redis } from 'ioredis';
import { createRedis } from '../../../src/lib/cache/redis.provider.js';
import { silentLogger } from './test-database.js';

/** Logical database 15 keeps test keys away from local development data in database 0. */
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';

export function createTestRedis(url = TEST_REDIS_URL): Redis {
  return createRedis({ url, connectionName: 'nile-test', logger: silentLogger });
}
