import pg from 'pg';

/** PostgreSQL SQLSTATE codes the application reacts to. */
export const PG_ERROR = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  NOT_NULL_VIOLATION: '23502',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
} as const;

export type PgErrorCode = (typeof PG_ERROR)[keyof typeof PG_ERROR];

export type PgError = InstanceType<typeof pg.DatabaseError>;

/** True if `err` is an error reported by PostgreSQL, optionally with the given SQLSTATE code. */
export function isPgError(err: unknown, code?: PgErrorCode): err is PgError {
  return err instanceof pg.DatabaseError && (code === undefined || err.code === code);
}

/**
 * True if `err` violates the named constraint. Repositories use this to translate specific
 * constraints into domain errors, e.g. `users_email_key` → UserAlreadyExistsError.
 */
export function violatesConstraint(err: unknown, constraint: string): err is PgError {
  return isPgError(err) && err.constraint === constraint;
}
