import { Redis } from 'ioredis';
import { withoutCorrelation } from '../correlation/correlation-context.js';
import type { Logger } from '../logger/logger.js';

const CONNECT_TIMEOUT_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 5_000;
/**
 * Redis is infrastructure, not business truth: while it is unavailable, commands fail quickly
 * instead of queueing for a long time, and callers decide how to degrade.
 */
const MAX_RETRIES_PER_REQUEST = 2;

export interface CreateRedisOptions {
  url: string;
  /** Reported by CLIENT LIST (e.g. "nile-api"). */
  connectionName: string;
  logger: Logger;
}

/**
 * Creates the process-wide Redis client. It connects lazily on the first command and keeps
 * reconnecting with capped backoff; readiness checks (Task 1.14) report availability.
 */
export function createRedis({ url, connectionName, logger }: CreateRedisOptions): Redis {
  const redis = new Redis(url, {
    connectionName,
    lazyConnect: true,
    connectTimeout: CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: MAX_RETRIES_PER_REQUEST,
    retryStrategy: (attempt) => Math.min(attempt * 200, MAX_RECONNECT_DELAY_MS),
  });

  // Without an error listener ioredis reports "Unhandled error event" on every failed reconnect.
  // Connection events belong to no request, even when a request's command triggered them.
  redis.on('error', (err) =>
    withoutCorrelation(() => logger.warn({ err }, 'Redis connection error')),
  );
  redis.on('ready', () => withoutCorrelation(() => logger.info('Redis connection ready')));

  return redis;
}

/**
 * Closes the client and resolves once it has fully ended. Safe to call repeatedly.
 *
 * - ready: QUIT, so pending replies are delivered first.
 * - never connected / connecting: disconnect without opening a connection.
 * - reconnecting: disconnect cancels further attempts, but ioredis never emits "end" in this
 *   state, so do not wait for it.
 */
export async function closeRedis(redis: Redis): Promise<void> {
  switch (redis.status) {
    case 'end':
      return;
    case 'reconnecting':
      redis.disconnect();
      return;
    case 'ready': {
      const ended = endOf(redis);
      try {
        await redis.quit();
      } catch {
        // The connection dropped while quitting; stop reconnect attempts instead.
        redis.disconnect();
        return;
      }
      await ended;
      return;
    }
    default: {
      const ended = endOf(redis);
      redis.disconnect();
      await ended;
    }
  }
}

/** Resolves on the "end" event. Unlike events.once, it does not reject on "error" events. */
function endOf(redis: Redis): Promise<void> {
  return new Promise((resolve) => redis.once('end', () => resolve()));
}
