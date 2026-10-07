import type { Pool, QueryResult, QueryResultRow } from 'pg';
import { InternalError } from '../error/errors.js';
import { getTransactionContext } from './transaction-context.js';

/**
 * The single entry point repositories use to run SQL. Always pass values as parameters
 * ($1, $2, ...); never interpolate them into the SQL text.
 *
 * Inside TransactionManager.run() queries run on the transaction's client; otherwise on the pool.
 * Repositories therefore need no transaction parameter.
 */
export class Database {
  constructor(private readonly pool: Pool) {}

  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<R>> {
    const transaction = getTransactionContext();

    if (transaction) {
      if (!transaction.active) {
        // e.g. a promise started inside run() but not awaited. Its client is back in the pool
        // and may already serve another request, so it must not be used.
        throw new InternalError('Query issued after its transaction finished');
      }
      return transaction.client.query<R>(text, [...params]);
    }

    return this.pool.query<R>(text, [...params]);
  }
}
