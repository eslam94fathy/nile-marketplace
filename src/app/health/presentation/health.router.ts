import { Router } from 'express';
import { type HealthCheck, runHealthChecks } from '../../../lib/health/health-check.js';
import type { Logger } from '../../../lib/logger/logger.js';

/**
 * GET /health/live  — the process is running (no dependency checks; never restart for a DB outage).
 * GET /health/ready — the process can serve traffic: every required dependency is reachable.
 */
export function createHealthRouter(checks: readonly HealthCheck[], logger: Logger): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get('/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/ready', async (_req, res) => {
    const report = await runHealthChecks(checks, logger);
    res.status(report.status === 'ready' ? 200 : 503).json(report);
  });

  return router;
}
