import express, { type Express } from 'express';
import helmet from 'helmet';
import { correlationMiddleware } from './lib/correlation/correlation.middleware.js';
import { registerRoutes } from './routes.js';

export const JSON_BODY_LIMIT = '100kb';

/**
 * Builds the Express application without starting a server, so tests can use it directly.
 * The DI container is passed in from Task 1.10, together with the error-handling middleware.
 */
export function createApp(): Express {
  const app = express();

  app.use(correlationMiddleware());
  app.use(helmet());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  registerRoutes(app);

  return app;
}
