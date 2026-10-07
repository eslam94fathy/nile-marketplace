// HTTP process entrypoint. Must be the first import so tsyringe decorators can use the Reflect API.
import 'reflect-metadata';

import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { createApp } from './app.js';
import { closeRedis } from './lib/cache/redis.provider.js';
import { ConfigError, loadConfig } from './lib/config/load-config.js';
import { buildContainer } from './lib/dependency-injection/container.js';
import { TOKENS } from './lib/dependency-injection/tokens.js';
import { closeServer, listen } from './lib/http/http-server.js';
import { createGracefulShutdown } from './lib/lifecycle/graceful-shutdown.js';
import type { Logger } from './lib/logger/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const container = buildContainer({ config, processName: 'api' });
  const logger = container.resolve<Logger>(TOKENS.Logger);

  const shutdown = createGracefulShutdown({ logger, timeoutMs: SHUTDOWN_TIMEOUT_MS });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    void shutdown.shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    void shutdown.shutdown('uncaughtException', 1);
  });

  // Infrastructure closers are registered before the server so they are closed after it.
  const pool = container.resolve<Pool>(TOKENS.PgPool);
  shutdown.register('postgres-pool', () => pool.end());
  const redis = container.resolve<Redis>(TOKENS.Redis);
  shutdown.register('redis', () => closeRedis(redis));

  const server = await listen(createApp(container), config.http.port);
  shutdown.register('http-server', () => closeServer(server));
  logger.info({ port: config.http.port, nodeEnv: config.nodeEnv }, 'HTTP server listening');

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void shutdown.shutdown(signal));
  }
}

main().catch((err: unknown) => {
  // The logger may not exist yet (e.g. invalid configuration), so report to stderr directly.
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
