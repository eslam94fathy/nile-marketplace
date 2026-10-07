import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGracefulShutdown } from '../../../../src/lib/lifecycle/graceful-shutdown.js';
import { createLogger } from '../../../../src/lib/logger/logger.js';

const logger = createLogger({ name: 'test', level: 'silent', pretty: false });

function setup(timeoutMs = 1000) {
  const exit = vi.fn<(code: number) => void>();
  const shutdown = createGracefulShutdown({ logger, timeoutMs, exit });
  return { shutdown, exit };
}

describe('createGracefulShutdown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes resources in reverse registration order, then exits 0', async () => {
    const { shutdown, exit } = setup();
    const order: string[] = [];
    shutdown.register('pool', async () => void order.push('pool'));
    shutdown.register('redis', async () => void order.push('redis'));
    shutdown.register('server', async () => void order.push('server'));

    await shutdown.shutdown('SIGTERM');

    expect(order).toEqual(['server', 'redis', 'pool']);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('exits 0 when nothing is registered', async () => {
    const { shutdown, exit } = setup();

    await shutdown.shutdown('SIGTERM');

    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('keeps closing remaining resources when one fails, then exits 1', async () => {
    const { shutdown, exit } = setup();
    const closed: string[] = [];
    shutdown.register('pool', async () => void closed.push('pool'));
    shutdown.register('redis', async () => {
      throw new Error('redis close failed');
    });
    shutdown.register('server', async () => void closed.push('server'));

    await shutdown.shutdown('SIGTERM');

    expect(closed).toEqual(['server', 'pool']);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('uses the given exit code after a crash', async () => {
    const { shutdown, exit } = setup();
    shutdown.register('server', async () => {});

    await shutdown.shutdown('uncaughtException', 1);

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('runs only once when triggered repeatedly', async () => {
    const { shutdown, exit } = setup();
    const close = vi.fn(async () => {});
    shutdown.register('server', close);

    const first = shutdown.shutdown('SIGTERM');
    const second = shutdown.shutdown('SIGINT');
    await Promise.all([first, second]);

    expect(second).toBe(first);
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('forces exit 1 when closers exceed the timeout', async () => {
    vi.useFakeTimers();
    const { shutdown, exit } = setup(5000);
    shutdown.register('stuck', () => new Promise<void>(() => {}));

    const done = shutdown.shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(5000);
    await done;

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
