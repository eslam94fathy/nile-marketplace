/**
 * Injection tokens for infrastructure registered in the composition root.
 *
 * Every injected constructor parameter must use `@inject(TOKENS.X)` (or a module's own token):
 * decorator metadata is not emitted, so tsyringe cannot infer types. Tokens are added by the
 * task that introduces the dependency.
 */
export const TOKENS = {
  Config: Symbol('Config'),
  Logger: Symbol('Logger'),
  PgPool: Symbol('PgPool'),
  Database: Symbol('Database'),
} as const;
