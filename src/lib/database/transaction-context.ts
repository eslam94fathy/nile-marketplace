import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';

export type IsolationLevel = 'read committed' | 'repeatable read' | 'serializable';

export interface TransactionContext {
  readonly client: PoolClient;
  readonly isolationLevel: IsolationLevel;
  /** False once the transaction has committed or rolled back and the client was released. */
  active: boolean;
}

const storage = new AsyncLocalStorage<TransactionContext>();

/** Runs `fn` with the transaction context visible to Database.query and isInTransaction(). */
export function runInTransactionContext<T>(context: TransactionContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getTransactionContext(): TransactionContext | undefined {
  return storage.getStore();
}

/** True while running inside an active TransactionManager.run() call. */
export function isInTransaction(): boolean {
  return getTransactionContext()?.active === true;
}
