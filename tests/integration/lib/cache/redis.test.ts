import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import { closeRedis } from '../../../../src/lib/cache/redis.provider.js';
import { createTestRedis } from '../../support/test-redis.js';

describe('Redis client', () => {
  const clients: Redis[] = [];

  function client(url?: string): Redis {
    const redis = createTestRedis(url);
    clients.push(redis);
    return redis;
  }

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((redis) => closeRedis(redis)));
  });

  it('connects lazily on the first command', async () => {
    const redis = client();
    expect(redis.status).toBe('wait');

    expect(await redis.ping()).toBe('PONG');
    expect(redis.status).toBe('ready');
  });

  it('round-trips values with expiry', async () => {
    const redis = client();
    const key = `test:${randomUUID()}`;

    await redis.set(key, 'value', 'EX', 60);

    expect(await redis.get(key)).toBe('value');
    expect(await redis.ttl(key)).toBeGreaterThan(0);
    await redis.del(key);
  });

  it('uses the test logical database and identifies the connection', async () => {
    const redis = client();

    const info = await redis.client('INFO');

    expect(info).toContain('db=15');
    expect(await redis.client('GETNAME')).toBe('nile-test');
  });

  describe('closeRedis', () => {
    it('quits a connected client', async () => {
      const redis = client();
      await redis.ping();

      await closeRedis(redis);

      expect(redis.status).toBe('end');
      await expect(redis.ping()).rejects.toThrow('Connection is closed');
    });

    it('closes a never-connected client without opening a connection', async () => {
      const redis = client();
      let connected = false;
      redis.on('connect', () => {
        connected = true;
      });

      await closeRedis(redis);

      expect(redis.status).toBe('end');
      expect(connected).toBe(false);
    });

    it('is safe to call twice', async () => {
      const redis = client();
      await redis.ping();

      await closeRedis(redis);
      await expect(closeRedis(redis)).resolves.toBeUndefined();
    });

    it('closes a client that is still connecting', async () => {
      const redis = client();
      void redis.ping().catch(() => {});
      expect(redis.status).toBe('connecting');

      await closeRedis(redis);

      expect(redis.status).toBe('end');
    });
  });

  describe('when Redis is unreachable', () => {
    const UNREACHABLE = 'redis://127.0.0.1:1/15';

    it('fails commands quickly instead of queueing them indefinitely', async () => {
      const redis = client(UNREACHABLE);
      const started = Date.now();

      await expect(redis.ping()).rejects.toThrow(/max retries per request/i);
      expect(Date.now() - started).toBeLessThan(5_000);
    });

    it('closes immediately while reconnecting and stops further attempts', async () => {
      const redis = client(UNREACHABLE);
      await redis.ping().catch(() => {});
      expect(redis.status).toBe('reconnecting');
      let attemptsAfterClose = 0;
      redis.on('close', () => attemptsAfterClose++);
      const started = Date.now();

      await closeRedis(redis);
      await new Promise((resolve) => setTimeout(resolve, 1_000));

      expect(Date.now() - started).toBeLessThan(1_500);
      expect(attemptsAfterClose).toBe(0);
    });
  });
});
