import { type Express, Router } from 'express';

export const API_PREFIX = '/api/v1';

export function registerRoutes(app: Express): void {
  const api = Router();
  // Module routers are mounted on `api` as modules are implemented (Phase 2+).
  app.use(API_PREFIX, api);

  // Health endpoints (/health/live, /health/ready) are mounted in Task 1.14.
}
