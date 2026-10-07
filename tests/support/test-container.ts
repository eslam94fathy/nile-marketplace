import type { Express } from 'express';
import type { Redis } from 'ioredis';
import { createApp } from '../../src/app.js';
import type { Pool } from 'pg';
import type { DependencyContainer } from 'tsyringe';
import { closeRedis } from '../../src/lib/cache/redis.provider.js';
import type { Config } from '../../src/lib/config/config.schema.js';
import { loadConfig } from '../../src/lib/config/load-config.js';
import { buildContainer } from '../../src/lib/dependency-injection/container.js';
import { TOKENS } from '../../src/lib/dependency-injection/tokens.js';
import type { Logger } from '../../src/lib/logger/logger.js';

/** Fixed configuration for tests. Infrastructure clients connect lazily, so building it is free. */
const loadedTestConfig = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  POSTGRES_HOST: 'localhost',
  POSTGRES_USER: 'nile',
  POSTGRES_PASSWORD: 'nile',
  POSTGRES_DB: 'nile_test',
  REDIS_HOST: 'localhost',
  REDIS_DB: '15',
  RABBITMQ_HOST: 'localhost',
  RABBITMQ_USER: 'nile',
  RABBITMQ_PASSWORD: 'nile',
});

// TEST_DATABASE_URL / TEST_REDIS_URL override the targets, as in tests/integration/support.
export const testConfig: Config = {
  ...loadedTestConfig,
  db: { ...loadedTestConfig.db, url: process.env.TEST_DATABASE_URL ?? loadedTestConfig.db.url },
  redis: { url: process.env.TEST_REDIS_URL ?? loadedTestConfig.redis.url },
};

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

/** The real Express app wired to a test container. Close the container if it connected. */
export function createTestApp(options: TestContainerOptions = {}): {
  app: Express;
  container: DependencyContainer;
} {
  const container = createTestContainer(options);
  return { app: createApp(container), container };
}

/** Closes the infrastructure clients of a test container that actually connected. */
export async function closeTestContainer(container: DependencyContainer): Promise<void> {
  await Promise.all([
    container.resolve<Pool>(TOKENS.PgPool).end(),
    closeRedis(container.resolve<Redis>(TOKENS.Redis)),
  ]);
}
