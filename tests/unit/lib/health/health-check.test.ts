import { describe, expect, it } from 'vitest';
import { type HealthCheck, runHealthChecks } from '../../../../src/lib/health/health-check.js';
import { captureLogger } from '../../../support/capture-logger.js';

const up = (name: string, delayMs = 0): HealthCheck => ({
  name,
  check: () => new Promise((resolve) => setTimeout(resolve, delayMs)),
});
const failing = (name: string): HealthCheck => ({
  name,
  check: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432')),
});
const hanging = (name: string): HealthCheck => ({ name, check: () => new Promise(() => {}) });

describe('runHealthChecks', () => {
  it('is ready when every check passes', async () => {
    const { logger } = captureLogger();

    const report = await runHealthChecks([up('postgres'), up('redis')], logger);

    expect(report).toEqual({
      status: 'ready',
      checks: {
        postgres: { status: 'up', latencyMs: expect.any(Number) },
        redis: { status: 'up', latencyMs: expect.any(Number) },
      },
    });
  });

  it('is ready with no checks', async () => {
    const { logger } = captureLogger();

    expect(await runHealthChecks([], logger)).toEqual({ status: 'ready', checks: {} });
  });

  it('is not ready when a check fails, without exposing the raw error', async () => {
    const { logger, lines } = captureLogger();

    const report = await runHealthChecks([up('postgres'), failing('redis')], logger);

    expect(report.status).toBe('not_ready');
    expect(report.checks.redis).toEqual({
      status: 'down',
      error: 'unavailable',
      latencyMs: expect.any(Number),
    });
    expect(JSON.stringify(report)).not.toContain('10.0.0.5');
    // The detail goes to the logs instead.
    expect(JSON.stringify(lines)).toContain('ECONNREFUSED 10.0.0.5:5432');
  });

  it('reports a hanging check as a timeout once the timeout elapses', async () => {
    const { logger } = captureLogger();
    const started = performance.now();

    const report = await runHealthChecks([hanging('postgres')], logger, 50);

    expect(report.checks.postgres).toMatchObject({ status: 'down', error: 'timeout' });
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('runs checks concurrently', async () => {
    const { logger } = captureLogger();
    const started = performance.now();

    await runHealthChecks([up('a', 100), up('b', 100), up('c', 100)], logger);

    expect(performance.now() - started).toBeLessThan(250);
  });

  it('treats a check that throws synchronously as down', async () => {
    const { logger } = captureLogger();
    const throwsSync: HealthCheck = {
      name: 'broken',
      check: () => {
        throw new Error('sync failure');
      },
    };

    const report = await runHealthChecks([throwsSync], logger);

    expect(report.checks.broken).toMatchObject({ status: 'down', error: 'unavailable' });
  });
});
