import { getCorrelationId } from '../correlation/correlation-context.js';
import type { Database } from '../database/database.js';
import { isInTransaction } from '../database/transaction-context.js';
import { InternalError } from '../error/errors.js';

/** A domain event recorded for asynchronous publication. */
export interface OutboxEvent<P extends object = Record<string, unknown>> {
  /** e.g. "seller" */
  aggregateType: string;
  aggregateId: string;
  /** Lowercase dotted name, also the routing key, e.g. "seller.approved". */
  eventType: string;
  /** Stable identifiers and useful metadata; never secrets or credentials. */
  payload: P;
}

/**
 * Application port: records an event in the same transaction as the business change, so it is
 * published if and only if the change commits.
 */
export interface OutboxWriter {
  /** Returns the event ID (also the published message ID). Must run inside TransactionManager.run(). */
  append<P extends object>(event: OutboxEvent<P>): Promise<string>;
}

const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export class PgOutboxWriter implements OutboxWriter {
  constructor(private readonly db: Database) {}

  async append<P extends object>(event: OutboxEvent<P>): Promise<string> {
    if (!isInTransaction()) {
      // Outside a transaction the event could be stored while the business change fails, or lost
      // while it succeeds: exactly what the outbox exists to prevent.
      throw new InternalError('OutboxWriter.append must be called inside a transaction');
    }
    if (!EVENT_TYPE_PATTERN.test(event.eventType)) {
      throw new InternalError(`Invalid event type "${event.eventType}"`);
    }

    const result = await this.db.query<{ id: string }>(
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, correlation_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id`,
      [
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        // Always serialize: pg would turn a top-level JS array into a PostgreSQL array, not JSON.
        JSON.stringify(event.payload),
        getCorrelationId() ?? null,
      ],
    );

    const id = result.rows[0]?.id;
    if (!id) throw new InternalError('Outbox insert returned no id');
    return id;
  }
}
