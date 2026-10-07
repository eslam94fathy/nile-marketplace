// HTTP process entrypoint. Must be the first import so tsyringe decorators can use the Reflect API.
import 'reflect-metadata';

import { createApp } from './app.js';
import { ConfigError, loadConfig } from './lib/config/load-config.js';
import {
  buildContainer,
  registerInfrastructureShutdown,
} from './lib/dependency-injection/container.js';
import { TOKENS } from './lib/dependency-injection/tokens.js';
import { closeServer, listen } from './lib/http/http-server.js';
import { createGracefulShutdown } from './lib/lifecycle/graceful-shutdown.js';
import { installProcessHandlers } from './lib/lifecycle/process-handlers.js';
import type { Logger } from './lib/logger/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const container = buildContainer({ config, processName: 'api' });
  const logger = container.resolve<Logger>(TOKENS.Logger);

  const shutdown = createGracefulShutdown({ logger, timeoutMs: SHUTDOWN_TIMEOUT_MS });
  installProcessHandlers(shutdown, logger);
  // Infrastructure is registered before the server, so the server stops first.
  registerInfrastructureShutdown(container, shutdown);

  const server = await listen(createApp(container), config.http.port);
  shutdown.register('http-server', () => closeServer(server));
  logger.info({ port: config.http.port, nodeEnv: config.nodeEnv }, 'HTTP server listening');
}

main().catch((err: unknown) => {
  // The logger may not exist yet (e.g. invalid configuration), so report to stderr directly.
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
