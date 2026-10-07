import pg, { type Pool } from 'pg';
import type { Config } from '../config/config.schema.js';
import { withoutCorrelation } from '../correlation/correlation-context.js';
import type { Logger } from '../logger/logger.js';

/** Upper bound for a single statement; protects the pool from runaway queries. */
const STATEMENT_TIMEOUT_MS = 30_000;
/** Kills sessions that hold a transaction open without doing work (e.g. a leaked client). */
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;
const CONNECTION_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 30_000;

export interface CreatePoolOptions {
  db: Config['db'];
  /** Reported as application_name in pg_stat_activity (e.g. "nile-api"). */
  applicationName: string;
  logger: Logger;
}

/**
 * Creates the process-wide PostgreSQL pool. Connections are opened lazily; readiness checks
 * (Task 1.14) report database availability.
 */
export function createPool({ db, applicationName, logger }: CreatePoolOptions): Pool {
  const pool = new pg.Pool({
    connectionString: db.url,
    max: db.poolMax,
    application_name: applicationName,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });

  // Without this listener, an error on an idle client (e.g. server restart) crashes the process.
  pool.on('error', (err) => {
    withoutCorrelation(() => logger.error({ err }, 'Idle PostgreSQL client error'));
  });

  return pool;
}
