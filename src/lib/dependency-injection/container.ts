import { container as rootContainer, type DependencyContainer } from 'tsyringe';
import type { Pool } from 'pg';
import type { Config } from '../config/config.schema.js';
import { Database } from '../database/database.js';
import { createPool } from '../database/pool.provider.js';
import { createLogger, type Logger } from '../logger/logger.js';
import { TOKENS } from './tokens.js';

export interface BuildContainerOptions {
  config: Config;
  /** Process role used in logs ("api" or "worker"). */
  processName: string;
}

/**
 * Composition root: the only place infrastructure is constructed and registered.
 * Application code receives dependencies through `@inject(TOKEN)` and never instantiates them.
 *
 * Each call returns an isolated child container, so tests can build their own.
 */
export function buildContainer({
  config,
  processName,
}: BuildContainerOptions): DependencyContainer {
  const container = rootContainer.createChildContainer();

  container.register<Config>(TOKENS.Config, { useValue: config });

  // The correlation ID provider is wired in Task 1.9.
  const logger = createLogger({
    name: processName,
    level: config.log.level,
    pretty: config.nodeEnv === 'development',
  });
  container.register<Logger>(TOKENS.Logger, { useValue: logger });

  const pool = createPool({ db: config.db, applicationName: `nile-${processName}`, logger });
  container.register<Pool>(TOKENS.PgPool, { useValue: pool });
  container.register<Database>(TOKENS.Database, { useValue: new Database(pool) });

  // Remaining infrastructure (Tasks 1.8+) and application modules (registerXModule) go here.

  return container;
}
