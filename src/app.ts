import express, { type Express } from 'express';
import helmet from 'helmet';
import { registerRoutes } from './routes.js';

export const JSON_BODY_LIMIT = '100kb';

/**
 * Builds the Express application without starting a server, so tests can use it directly.
 * The DI container is passed in from Task 1.6; correlation (1.9) and error handling (1.10)
 * middleware are added in their tasks.
 */
export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  registerRoutes(app);

  return app;
}
