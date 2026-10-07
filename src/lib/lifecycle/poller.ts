import type { Logger } from '../logger/logger.js';

export interface PollerOptions {
  name: string;
  /** Wait between runs when there is no more work. */
  intervalMs: number;
  /** Upper bound for the delay after consecutive failures. */
  maxErrorBackoffMs?: number;
  logger: Logger;
  /** One unit of work. Resolves true if more work is pending (run again immediately). */
  task: () => Promise<boolean>;
}

export interface Poller {
  start(): void;
  /** Prevents further runs and waits for the in-flight run to finish. */
  stop(): Promise<void>;
}

/**
 * Runs a background task repeatedly, one run at a time:
 * - more work pending → run again immediately (drain a backlog),
 * - no more work → wait `intervalMs`,
 * - failure → log and back off exponentially up to `maxErrorBackoffMs`.
 */
export function createPoller(options: PollerOptions): Poller {
  const { name, intervalMs, maxErrorBackoffMs = 30_000, logger, task } = options;
  let started = false;
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;
  let consecutiveFailures = 0;

  function schedule(delayMs: number): void {
    if (stopping) return;
    timer = setTimeout(() => {
      inFlight = runOnce();
    }, delayMs);
  }

  async function runOnce(): Promise<void> {
    try {
      const hasMore = await task();
      consecutiveFailures = 0;
      schedule(hasMore ? 0 : intervalMs);
    } catch (err) {
      consecutiveFailures++;
      const delayMs = Math.min(intervalMs * 2 ** consecutiveFailures, maxErrorBackoffMs);
      logger.error(
        { err, poller: name, consecutiveFailures, retryInMs: delayMs },
        'Poller run failed',
      );
      schedule(delayMs);
    }
  }

  return {
    start() {
      if (started) return;
      started = true;
      logger.info({ poller: name, intervalMs }, 'Poller started');
      schedule(0);
    },
    async stop() {
      stopping = true;
      clearTimeout(timer);
      await inFlight;
      if (started) logger.info({ poller: name }, 'Poller stopped');
    },
  };
}
