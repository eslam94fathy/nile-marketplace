import express, { type Express } from 'express';
import { correlationMiddleware } from '../../../lib/correlation/correlation.middleware.js';
import { errorHandler } from '../../../lib/error/error-handler.middleware.js';
import { notFoundMiddleware } from '../../../lib/error/not-found.middleware.js';
import type { HealthCheck } from '../../../lib/health/health-check.js';
import type { Logger } from '../../../lib/logger/logger.js';
import { createHealthRouter } from './health.router.js';

/**
 * A minimal HTTP app serving only /health/live and /health/ready, for processes that have no
 * other HTTP interface (the worker).
 */
export function createStandaloneHealthApp(checks: readonly HealthCheck[], logger: Logger): Express {
  const app = express();
  app.use(correlationMiddleware());
  app.use('/health', createHealthRouter(checks, logger));
  app.use(notFoundMiddleware());
  app.use(errorHandler(logger));
  return app;
}
