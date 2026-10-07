import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import type { DependencyContainer } from 'tsyringe';
import { closeRedis } from '../../src/lib/cache/redis.provider.js';
import type { Config } from '../../src/lib/config/config.schema.js';
import { loadConfig } from '../../src/lib/config/load-config.js';
import { buildContainer } from '../../src/lib/dependency-injection/container.js';
import { TOKENS } from '../../src/lib/dependency-injection/tokens.js';
import type { Logger } from '../../src/lib/logger/logger.js';

/** Fixed configuration for tests. Infrastructure clients connect lazily, so building it is free. */
export const testConfig: Config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://nile:nile@localhost:5432/nile_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
  RABBITMQ_URL: 'amqp://nile:nile@localhost:5672',
});

export interface TestContainerOptions {
  /** Replaces the logger (e.g. a capturing logger). */
  logger?: Logger;
  /** Overrides parts of the test config, e.g. an unreachable Redis URL. */
  config?: { db?: Partial<Config['db']>; redis?: Partial<Config['redis']> };
}

export function createTestContainer(options: TestContainerOptions = {}): DependencyContainer {
  const config: Config = {
    ...testConfig,
    db: { ...testConfig.db, ...options.config?.db },
    redis: { ...testConfig.redis, ...options.config?.redis },
  };
  const container = buildContainer({ config, processName: 'test' });
  if (options.logger) {
    container.register<Logger>(TOKENS.Logger, { useValue: options.logger });
  }
  return container;
}

/** Closes the infrastructure clients of a test container that actually connected. */
export async function closeTestContainer(container: DependencyContainer): Promise<void> {
  await Promise.all([
    container.resolve<Pool>(TOKENS.PgPool).end(),
    closeRedis(container.resolve<Redis>(TOKENS.Redis)),
  ]);
}
