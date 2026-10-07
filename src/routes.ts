import type { Redis } from 'ioredis';
import { type Express, Router } from 'express';
import type { DependencyContainer } from 'tsyringe';
import { createHealthRouter } from './app/health/presentation/health.router.js';
import type { Database } from './lib/database/database.js';
import { TOKENS } from './lib/dependency-injection/tokens.js';
import { postgresHealthCheck, redisHealthCheck } from './lib/health/checks.js';
import type { Logger } from './lib/logger/logger.js';

export const API_PREFIX = '/api/v1';

export function registerRoutes(app: Express, container: DependencyContainer): void {
  // Unversioned: used by load balancers and orchestrators, not API clients.
  // RabbitMQ is not checked here: the API never talks to it (the worker relays the outbox).
  const apiDependencies = [
    postgresHealthCheck(container.resolve<Database>(TOKENS.Database)),
    redisHealthCheck(container.resolve<Redis>(TOKENS.Redis)),
  ];
  app.use('/health', createHealthRouter(apiDependencies, container.resolve<Logger>(TOKENS.Logger)));

  const api = Router();
  // Module routers are mounted on `api` as modules are implemented (Phase 2+).
  app.use(API_PREFIX, api);
}
