import type { Logger } from '../logger/logger.js';
import type { GracefulShutdown } from './graceful-shutdown.js';

/**
 * Wires process-level events to graceful shutdown: SIGTERM/SIGINT stop cleanly (exit 0);
 * an uncaught exception or unhandled rejection is logged as fatal and stops with exit code 1.
 */
export function installProcessHandlers(shutdown: GracefulShutdown, logger: Logger): void {
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    void shutdown.shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    void shutdown.shutdown('uncaughtException', 1);
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void shutdown.shutdown(signal));
  }
}
