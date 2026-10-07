// Worker process entrypoint. Must be the first import so tsyringe decorators can use the Reflect API.
import 'reflect-metadata';

import { ConfigError, loadConfig } from './lib/config/load-config.js';
import { installProcessHandlers } from './lib/lifecycle/process-handlers.js';
import { startWorker } from './start-worker.js';

async function main(): Promise<void> {
  const { shutdown, logger } = await startWorker({ config: loadConfig() });
  installProcessHandlers(shutdown, logger);
}

main().catch((err: unknown) => {
  // The logger may not exist yet (e.g. invalid configuration), so report to stderr directly.
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
