import type { DependencyContainer } from 'tsyringe';
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

/** Builds a container with the test config, optionally replacing the logger. */
export function createTestContainer(options: { logger?: Logger } = {}): DependencyContainer {
  const container = buildContainer({ config: testConfig, processName: 'test' });
  if (options.logger) {
    container.register<Logger>(TOKENS.Logger, { useValue: options.logger });
  }
  return container;
}
