import type { Logger } from '../logger/logger.js';

export type Closer = () => Promise<void>;

export interface GracefulShutdownOptions {
  logger: Logger;
  /** Forces exit if closers have not finished within this time. */
  timeoutMs: number;
  /** Injected for tests. */
  exit?: (code: number) => void;
}

export interface GracefulShutdown {
  /** Registers a resource to close. Closers run in reverse registration order (LIFO). */
  register(name: string, close: Closer): void;
  /**
   * Closes every registered resource once, then exits. Exits with `exitCode` (default 0) unless a
   * closer fails or the timeout is hit, which exit with 1. Repeated calls return the first run.
   */
  shutdown(reason: string, exitCode?: number): Promise<void>;
}

/**
 * Coordinates process shutdown for the API and the worker. Resources are registered in startup
 * order (e.g. pool, redis, server) and closed in reverse, so the HTTP server stops accepting
 * traffic before the dependencies it uses are closed.
 */
export function createGracefulShutdown(options: GracefulShutdownOptions): GracefulShutdown {
  const { logger, timeoutMs, exit = (code) => process.exit(code) } = options;
  const closers: { name: string; close: Closer }[] = [];
  let running: Promise<void> | undefined;

  async function closeAll(): Promise<boolean> {
    let ok = true;
    for (const { name, close } of [...closers].reverse()) {
      try {
        await close();
        logger.info({ resource: name }, 'Closed resource');
      } catch (err) {
        ok = false;
        logger.error({ err, resource: name }, 'Failed to close resource');
      }
    }
    return ok;
  }

  async function run(reason: string, exitCode: number): Promise<void> {
    logger.info({ reason }, 'Shutting down');

    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });

    const result = await Promise.race([closeAll(), timedOut]);
    clearTimeout(timer);

    if (result === 'timeout') {
      logger.error({ timeoutMs }, 'Shutdown timed out; forcing exit');
      exit(1);
      return;
    }

    logger.info('Shutdown complete');
    exit(result ? exitCode : 1);
  }

  return {
    register(name, close) {
      closers.push({ name, close });
    },
    shutdown(reason, exitCode = 0) {
      running ??= run(reason, exitCode);
      return running;
    },
  };
}
