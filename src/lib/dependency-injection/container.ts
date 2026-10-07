import { container as rootContainer, type DependencyContainer } from 'tsyringe';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { createRedis } from '../cache/redis.provider.js';
import type { Config } from '../config/config.schema.js';
import { getCorrelationId } from '../correlation/correlation-context.js';
import { Database } from '../database/database.js';
import { createPool } from '../database/pool.provider.js';
import { type OutboxWriter, PgOutboxWriter } from '../events/outbox.writer.js';
import { createLogger, type Logger } from '../logger/logger.js';
import {
  PgTransactionManager,
  type TransactionManager,
} from '../transaction/transaction-manager.js';
import { TOKENS } from './tokens.js';

export interface BuildContainerOptions {
  config: Config;
  /** Process role used in logs ("api" or "worker"). */
  processName: string;
}

/**
 * Composition root: the only place infrastructure is constructed and registered.
 * Application code receives dependencies through `@inject(TOKEN)` and never instantiates them.
 *
 * Each call returns an isolated child container, so tests can build their own.
 */
export function buildContainer({
  config,
  processName,
}: BuildContainerOptions): DependencyContainer {
  const container = rootContainer.createChildContainer();

  container.register<Config>(TOKENS.Config, { useValue: config });

  const logger = createLogger({
    name: processName,
    level: config.log.level,
    pretty: config.nodeEnv === 'development',
    getCorrelationId,
  });
  container.register<Logger>(TOKENS.Logger, { useValue: logger });

  const pool = createPool({ db: config.db, applicationName: `nile-${processName}`, logger });
  container.register<Pool>(TOKENS.PgPool, { useValue: pool });
  container.register<Database>(TOKENS.Database, { useValue: new Database(pool) });
  container.register<TransactionManager>(TOKENS.TransactionManager, {
    useValue: new PgTransactionManager(pool, logger),
  });
  const database = container.resolve<Database>(TOKENS.Database);
  container.register<OutboxWriter>(TOKENS.OutboxWriter, {
    useValue: new PgOutboxWriter(database),
  });
  // The outbox relay and message publisher are worker-only; they are wired in worker.ts (Task 1.17).

  const redis = createRedis({
    url: config.redis.url,
    connectionName: `nile-${processName}`,
    logger,
  });
  container.register<Redis>(TOKENS.Redis, { useValue: redis });

  // Remaining infrastructure (Tasks 1.9+) and application modules (registerXModule) go here.

  return container;
}
