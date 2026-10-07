import type { Server } from 'node:http';
import type { DependencyContainer } from 'tsyringe';
import { createStandaloneHealthApp } from './app/health/presentation/health-app.js';
import type { Config } from './lib/config/config.schema.js';
import type { Database } from './lib/database/database.js';
import {
  buildContainer,
  registerInfrastructureShutdown,
  registerWorkerDependencies,
} from './lib/dependency-injection/container.js';
import { TOKENS } from './lib/dependency-injection/tokens.js';
import type { OutboxRelay } from './lib/events/outbox.relay.js';
import { postgresHealthCheck, rabbitmqHealthCheck } from './lib/health/checks.js';
import { closeServer, listen } from './lib/http/http-server.js';
import {
  createGracefulShutdown,
  type GracefulShutdown,
} from './lib/lifecycle/graceful-shutdown.js';
import { createPoller } from './lib/lifecycle/poller.js';
import type { Logger } from './lib/logger/logger.js';
import type { MessagePublisher } from './pkg/messaging/message-publisher.js';

export const WORKER_SHUTDOWN_TIMEOUT_MS = 15_000;

export interface StartWorkerOptions {
  config: Config;
  /** Injected for tests; defaults to process.exit. */
  exit?: (code: number) => void;
}

export interface RunningWorker {
  container: DependencyContainer;
  logger: Logger;
  shutdown: GracefulShutdown;
  healthServer: Server;
}

/**
 * Starts the background worker: the outbox relay loop plus health endpoints. Independent of the
 * HTTP API process; it shares only the database and configuration.
 */
export async function startWorker({ config, exit }: StartWorkerOptions): Promise<RunningWorker> {
  const container = buildContainer({ config, processName: 'worker' });
  registerWorkerDependencies(container);
  const logger = container.resolve<Logger>(TOKENS.Logger);

  const shutdown = createGracefulShutdown({ logger, timeoutMs: WORKER_SHUTDOWN_TIMEOUT_MS, exit });
  registerInfrastructureShutdown(container, shutdown);

  // Readiness covers what the worker needs: PostgreSQL (outbox) and RabbitMQ (publishing).
  const healthServer = await listen(
    createStandaloneHealthApp(
      [
        postgresHealthCheck(container.resolve<Database>(TOKENS.Database)),
        rabbitmqHealthCheck(container.resolve<MessagePublisher>(TOKENS.MessagePublisher)),
      ],
      logger,
    ),
    config.worker.healthPort,
  );
  shutdown.register('health-server', () => closeServer(healthServer));

  const relay = container.resolve<OutboxRelay>(TOKENS.OutboxRelay);
  const outboxPoller = createPoller({
    name: 'outbox-relay',
    intervalMs: config.outbox.pollIntervalMs,
    logger,
    task: async () => {
      const { published, failed } = await relay.relayBatch();
      // A full batch means more events are probably waiting: drain without delay.
      return published + failed >= config.outbox.batchSize;
    },
  });
  // Registered last, so it stops first: the in-flight batch finishes before connections close.
  shutdown.register('outbox-relay', () => outboxPoller.stop());
  outboxPoller.start();

  logger.info({ healthPort: config.worker.healthPort }, 'Worker started');
  return { container, logger, shutdown, healthServer };
}
