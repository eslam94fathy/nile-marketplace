import type { Logger } from '../logger/logger.js';

/** A dependency the process needs in order to serve traffic. */
export interface HealthCheck {
  name: string;
  /** Resolves when the dependency is usable; rejects otherwise. */
  check(): Promise<void>;
}

export type CheckResult =
  | { status: 'up'; latencyMs: number }
  /** `error` is deliberately coarse: raw errors (hosts, ports) stay in the logs. */
  | { status: 'down'; latencyMs: number; error: 'timeout' | 'unavailable' };

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  checks: Record<string, CheckResult>;
}

export const DEFAULT_CHECK_TIMEOUT_MS = 2_000;

/** Runs all checks concurrently, each bounded by `timeoutMs`. Never rejects. */
export async function runHealthChecks(
  checks: readonly HealthCheck[],
  logger: Logger,
  timeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
): Promise<ReadinessReport> {
  const results = await Promise.all(
    checks.map(async (check) => [check.name, await runOne(check, logger, timeoutMs)] as const),
  );

  return {
    status: results.every(([, result]) => result.status === 'up') ? 'ready' : 'not_ready',
    checks: Object.fromEntries(results),
  };
}

const TIMED_OUT = Symbol('timed out');

async function runOne(check: HealthCheck, logger: Logger, timeoutMs: number): Promise<CheckResult> {
  const started = performance.now();
  const latency = () => Math.round(performance.now() - started);
  let timer: NodeJS.Timeout | undefined;

  try {
    const outcome = await Promise.race([
      check.check(),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
      }),
    ]);

    if (outcome === TIMED_OUT) {
      logger.warn({ dependency: check.name, timeoutMs }, 'Health check timed out');
      return { status: 'down', latencyMs: latency(), error: 'timeout' };
    }
    return { status: 'up', latencyMs: latency() };
  } catch (err) {
    logger.warn({ err, dependency: check.name }, 'Health check failed');
    return { status: 'down', latencyMs: latency(), error: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}
