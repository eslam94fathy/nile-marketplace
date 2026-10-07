import { container as rootContainer, type DependencyContainer } from 'tsyringe';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import type { MessagePublisher } from '../../pkg/messaging/message-publisher.js';
import { RabbitMqPublisher } from '../../pkg/messaging/rabbitmq-publisher.js';
import { type AuditLogger, PgAuditLogger } from '../audit/audit.logger.js';
import { closeRedis, createRedis } from '../cache/redis.provider.js';
import type { Config } from '../config/config.schema.js';
import { getCorrelationId } from '../correlation/correlation-context.js';
import { Database } from '../database/database.js';
import { createPool } from '../database/pool.provider.js';
import { EVENTS_EXCHANGE, OutboxRelay } from '../events/outbox.relay.js';
import { type OutboxWriter, PgOutboxWriter } from '../events/outbox.writer.js';
import type { GracefulShutdown } from '../lifecycle/graceful-shutdown.js';
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
  const database = new Database(pool);
  container.register<Pool>(TOKENS.PgPool, { useValue: pool });
  container.register<Database>(TOKENS.Database, { useValue: database });
  container.register<TransactionManager>(TOKENS.TransactionManager, {
    useValue: new PgTransactionManager(pool, logger),
  });
  container.register<OutboxWriter>(TOKENS.OutboxWriter, { useValue: new PgOutboxWriter(database) });
  container.register<AuditLogger>(TOKENS.AuditLogger, { useValue: new PgAuditLogger(database) });

  const redis = createRedis({
    url: config.redis.url,
    connectionName: `nile-${processName}`,
    logger,
  });
  container.register<Redis>(TOKENS.Redis, { useValue: redis });

  // Application modules (registerXModule) are registered here from Phase 2.

  return container;
}

/** Worker-only dependencies: the message publisher and the outbox relay. */
export function registerWorkerDependencies(container: DependencyContainer): void {
  const config = container.resolve<Config>(TOKENS.Config);
  const logger = container.resolve<Logger>(TOKENS.Logger);

  const publisher = new RabbitMqPublisher({
    url: config.rabbitmq.url,
    exchange: EVENTS_EXCHANGE,
    connectionName: 'nile-worker',
    onError: (err) => logger.warn({ err }, 'RabbitMQ connection error'),
  });
  container.register<MessagePublisher>(TOKENS.MessagePublisher, { useValue: publisher });

  container.register<OutboxRelay>(TOKENS.OutboxRelay, {
    useValue: new OutboxRelay(
      container.resolve<Database>(TOKENS.Database),
      container.resolve<TransactionManager>(TOKENS.TransactionManager),
      publisher,
      logger,
      { batchSize: config.outbox.batchSize, maxAttempts: config.outbox.maxAttempts },
    ),
  });
}

/**
 * Registers infrastructure closers. Call before registering servers and pollers: closers run in
 * reverse order, so those stop first and infrastructure they use is closed last.
 */
export function registerInfrastructureShutdown(
  container: DependencyContainer,
  shutdown: GracefulShutdown,
): void {
  const pool = container.resolve<Pool>(TOKENS.PgPool);
  shutdown.register('postgres-pool', () => pool.end());

  const redis = container.resolve<Redis>(TOKENS.Redis);
  shutdown.register('redis', () => closeRedis(redis));

  if (container.isRegistered(TOKENS.MessagePublisher)) {
    const publisher = container.resolve<MessagePublisher>(TOKENS.MessagePublisher);
    shutdown.register('rabbitmq-publisher', () => publisher.close());
  }
}
