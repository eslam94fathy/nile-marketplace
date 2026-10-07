import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPoller, type Poller } from '../../../../src/lib/lifecycle/poller.js';
import { captureLogger } from '../../../support/capture-logger.js';

describe('createPoller', () => {
  const pollers: Poller[] = [];

  function poller(task: () => Promise<boolean>, intervalMs = 50, maxErrorBackoffMs = 30_000) {
    const { logger, lines } = captureLogger();
    const instance = createPoller({ name: 'test', intervalMs, maxErrorBackoffMs, logger, task });
    pollers.push(instance);
    return { instance, lines };
  }

  afterEach(async () => {
    await Promise.all(pollers.splice(0).map((p) => p.stop()));
  });

  // Timing assertions in this file are lower bounds or values the poller computes and logs:
  // machine load can only make waits longer, so upper bounds on wall-clock time are flaky.

  it('waits the interval between runs when there is no more work', async () => {
    const runs: number[] = [];
    const { instance } = poller(async () => {
      runs.push(performance.now());
      return false;
    }, 100);

    instance.start();
    await vi.waitFor(() => expect(runs.length).toBeGreaterThanOrEqual(2), {
      timeout: 5_000,
      interval: 5,
    });
    await instance.stop();

    expect((runs[1] ?? 0) - (runs[0] ?? 0)).toBeGreaterThanOrEqual(90);
  });

  it('runs again immediately while more work is pending', async () => {
    let remaining = 5;
    let runs = 0;
    const { instance } = poller(async () => {
      runs++;
      remaining = Math.max(remaining - 1, 0);
      return remaining > 0;
    }, 10_000);

    const started = Date.now();
    instance.start();
    await vi.waitFor(() => expect(runs).toBe(5), { timeout: 5_000, interval: 5 });

    // Drained back to back: far less than a single 10s interval.
    expect(Date.now() - started).toBeLessThan(2_000);
    await delay(50);
    expect(runs).toBe(5); // then waits for the interval
  });

  it('never runs two tasks at the same time', async () => {
    let active = 0;
    let maxActive = 0;
    const { instance } = poller(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(20);
      active--;
      return true;
    }, 1);

    instance.start();
    await delay(150);
    await instance.stop();

    expect(maxActive).toBe(1);
  });

  it('logs failures, backs off exponentially, and recovers', async () => {
    const runs: number[] = [];
    let failuresLeft = 3;
    const { instance, lines } = poller(async () => {
      runs.push(performance.now());
      if (failuresLeft-- > 0) throw new Error('database unavailable');
      return false;
    }, 20);

    instance.start();
    await vi.waitFor(() => expect(runs.length).toBeGreaterThanOrEqual(4), {
      timeout: 5_000,
      interval: 5,
    });
    await instance.stop();

    const errors = lines.filter((line) => line.level === 'error');
    expect(errors.map((line) => line.consecutiveFailures)).toEqual([1, 2, 3]);
    expect(errors.map((line) => line.retryInMs)).toEqual([40, 80, 160]);
    // And it actually waited at least that long before each retry.
    const gaps = runs.slice(1, 4).map((at, i) => at - (runs[i] ?? 0));
    expect(gaps[0]).toBeGreaterThanOrEqual(35);
    expect(gaps[1]).toBeGreaterThanOrEqual(75);
    expect(gaps[2]).toBeGreaterThanOrEqual(155);
  });

  it('caps the error backoff', async () => {
    const { instance, lines } = poller(
      async () => {
        throw new Error('down');
      },
      20,
      50,
    );

    instance.start();
    await vi.waitFor(
      () => expect(lines.filter((line) => line.level === 'error').length).toBeGreaterThanOrEqual(4),
      { timeout: 5_000, interval: 5 },
    );
    await instance.stop();

    // Uncapped this would be 40, 80, 160, 320.
    const delays = lines.filter((line) => line.level === 'error').map((line) => line.retryInMs);
    expect(delays.slice(0, 4)).toEqual([40, 50, 50, 50]);
  });

  it('stop() waits for the in-flight run and prevents further runs', async () => {
    let completed = 0;
    let runs = 0;
    const { instance } = poller(async () => {
      runs++;
      await delay(80);
      completed++;
      return true;
    }, 1);

    instance.start();
    await delay(20);
    await instance.stop();

    expect(completed).toBe(runs);
    const runsAtStop = runs;
    await delay(100);
    expect(runs).toBe(runsAtStop);
  });

  it('start() is idempotent and stop() before start() is safe', async () => {
    let runs = 0;
    const { instance } = poller(async () => {
      runs++;
      return false;
    }, 10_000);

    await instance.stop();
    const { instance: second } = poller(async () => {
      runs++;
      return false;
    }, 10_000);
    second.start();
    second.start();
    await delay(50);

    expect(runs).toBe(1);
  });
});
