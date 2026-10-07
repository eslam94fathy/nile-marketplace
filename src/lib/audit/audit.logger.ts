import { getCorrelationId } from '../correlation/correlation-context.js';
import type { Database } from '../database/database.js';
import { InternalError } from '../error/errors.js';

export type AuditActor =
  | { type: 'user'; id: string }
  /** The application itself, e.g. the worker or a scheduled job. */
  | { type: 'system' }
  /** An unauthenticated caller, e.g. a failed login. */
  | { type: 'anonymous' };

export interface AuditEntry {
  actor: AuditActor;
  /** Lowercase dotted name, e.g. "seller.approved", "auth.login_failed". */
  action: string;
  /** The entity acted upon, if any. */
  entity?: { type: string; id: string };
  /** Context such as previous/new status or a reason. Never credentials, tokens or secrets. */
  metadata?: Record<string, unknown>;
}

/**
 * Application port for the audit trail (blueprint §15).
 *
 * Inside TransactionManager.run() the record commits or rolls back with the business change:
 * right for successful actions ("seller approved" only if the approval committed). Record
 * failures (e.g. failed logins) outside the business transaction so they are kept.
 */
export interface AuditLogger {
  /** Returns the audit record ID. */
  record(entry: AuditEntry): Promise<string>;
}

const ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** Keys that must never be stored in audit metadata (compared case-insensitively). */
const FORBIDDEN_METADATA_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'authorization',
  'cookie',
  'apikey',
  'cardnumber',
  'cvv',
]);

export class PgAuditLogger implements AuditLogger {
  constructor(private readonly db: Database) {}

  async record(entry: AuditEntry): Promise<string> {
    if (!ACTION_PATTERN.test(entry.action)) {
      throw new InternalError(`Invalid audit action "${entry.action}"`);
    }
    const metadata = entry.metadata ?? {};
    const forbiddenPath = findForbiddenKey(metadata);
    if (forbiddenPath) {
      throw new InternalError(`Audit metadata must not contain sensitive data (${forbiddenPath})`);
    }

    const result = await this.db.query<{ id: string }>(
      `INSERT INTO audit_logs
         (actor_type, actor_id, action, entity_type, entity_id, metadata, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING id`,
      [
        entry.actor.type,
        entry.actor.type === 'user' ? entry.actor.id : null,
        entry.action,
        entry.entity?.type ?? null,
        entry.entity?.id ?? null,
        JSON.stringify(metadata),
        getCorrelationId() ?? null,
      ],
    );

    const id = result.rows[0]?.id;
    if (!id) throw new InternalError('Audit insert returned no id');
    return id;
  }
}

/** Returns the path of the first forbidden key, searching nested objects and arrays. */
function findForbiddenKey(value: unknown, path = 'metadata'): string | undefined {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findForbiddenKey(item, `${path}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;

  for (const [key, nested] of Object.entries(value)) {
    const keyPath = `${path}.${key}`;
    if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''))) return keyPath;
    const found = findForbiddenKey(nested, keyPath);
    if (found) return found;
  }
  return undefined;
}
