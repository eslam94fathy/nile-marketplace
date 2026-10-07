import express, { type Express } from 'express';
import helmet from 'helmet';
import type { DependencyContainer } from 'tsyringe';
import { correlationMiddleware } from './lib/correlation/correlation.middleware.js';
import { TOKENS } from './lib/dependency-injection/tokens.js';
import { errorHandler } from './lib/error/error-handler.middleware.js';
import { notFoundMiddleware } from './lib/error/not-found.middleware.js';
import type { Logger } from './lib/logger/logger.js';
import { registerRoutes } from './routes.js';

export const JSON_BODY_LIMIT = '100kb';

/** Builds the Express application without starting a server, so tests can use it directly. */
export function createApp(container: DependencyContainer): Express {
  const app = express();

  app.use(correlationMiddleware());
  app.use(helmet());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  registerRoutes(app, container);

  app.use(notFoundMiddleware());
  app.use(errorHandler(container.resolve<Logger>(TOKENS.Logger)));

  return app;
}
