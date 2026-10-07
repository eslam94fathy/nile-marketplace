import type { Pool, PoolClient } from 'pg';
import {
  getTransactionContext,
  type IsolationLevel,
  runInTransactionContext,
  type TransactionContext,
} from '../database/transaction-context.js';
import { InternalError } from '../error/errors.js';
import type { Logger } from '../logger/logger.js';

export type { IsolationLevel };

export interface TransactionOptions {
  /** Defaults to "read committed". */
  isolationLevel?: IsolationLevel;
}

/**
 * Application port for running multi-step business operations atomically.
 *
 *   await transactions.run(async () => {
 *     await orders.create(order);           // repositories use Database.query as usual
 *     await inventory.reserve(items);
 *     await outbox.append(orderCreated);
 *   });
 *
 * Everything inside `fn` commits together, or nothing does if it throws. A nested run() joins
 * the outer transaction.
 */
export interface TransactionManager {
  run<T>(fn: () => Promise<T>, options?: TransactionOptions): Promise<T>;
}

const BEGIN_SQL: Record<IsolationLevel, string> = {
  'read committed': 'BEGIN ISOLATION LEVEL READ COMMITTED',
  'repeatable read': 'BEGIN ISOLATION LEVEL REPEATABLE READ',
  serializable: 'BEGIN ISOLATION LEVEL SERIALIZABLE',
};

export class PgTransactionManager implements TransactionManager {
  constructor(
    private readonly pool: Pool,
    private readonly logger: Logger,
  ) {}

  async run<T>(fn: () => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const outer = getTransactionContext();
    if (outer) {
      if (!outer.active) {
        throw new InternalError('Transaction started from work that outlived its transaction');
      }
      if (options.isolationLevel && options.isolationLevel !== outer.isolationLevel) {
        throw new InternalError(
          `Cannot join a "${outer.isolationLevel}" transaction with "${options.isolationLevel}"`,
        );
      }
      return fn();
    }

    const isolationLevel = options.isolationLevel ?? 'read committed';
    const client = await this.pool.connect();
    // A checked-out client emits "error" if its connection dies (e.g. the server terminates it).
    // Unlike pool.query(), nothing else listens while we hold it, and an unhandled "error" event
    // would crash the process. The failure itself surfaces through the pending/next query.
    const onConnectionError = (err: Error) =>
      this.logger.warn({ err }, 'Database connection lost during transaction');
    client.on('error', onConnectionError);

    const context: TransactionContext = { client, isolationLevel, active: true };
    let discardReason: Error | undefined;

    try {
      return await runInTransactionContext(context, async () => {
        await client.query(BEGIN_SQL[isolationLevel]);
        const value = await fn();
        const commit = await client.query('COMMIT');
        if (commit.command === 'ROLLBACK') {
          // PostgreSQL answers COMMIT with ROLLBACK (not an error) when a statement inside the
          // transaction failed and the error was caught. Nothing was saved.
          throw new InternalError('Transaction was rolled back: a statement inside it failed');
        }
        return value;
      });
    } catch (err) {
      context.active = false;
      discardReason = await this.rollback(client);
      throw err;
    } finally {
      context.active = false;
      client.off('error', onConnectionError);
      // Passing an error destroys the connection instead of returning it to the pool.
      client.release(discardReason);
    }
  }

  /** Rolls back; returns an error if the connection is unusable and must be discarded. */
  private async rollback(client: PoolClient): Promise<Error | undefined> {
    try {
      await client.query('ROLLBACK');
      return undefined;
    } catch (rollbackError) {
      this.logger.warn({ err: rollbackError }, 'Rollback failed; discarding database connection');
      return rollbackError instanceof Error ? rollbackError : new Error('Rollback failed');
    }
  }
}
