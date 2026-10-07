import type { Pool, QueryResult, QueryResultRow } from 'pg';

/**
 * The single entry point repositories use to run SQL. Always pass values as parameters
 * ($1, $2, ...); never interpolate them into the SQL text.
 *
 * Task 1.13 makes this transaction-aware: queries will run on the active transaction's client
 * when called inside TransactionManager.run().
 */
export class Database {
  constructor(private readonly pool: Pool) {}

  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, [...params]);
  }
}
