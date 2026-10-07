import type { MessagePublisher, OutgoingMessage } from '../../pkg/messaging/message-publisher.js';
import { generateCorrelationId, runWithCorrelationId } from '../correlation/correlation-context.js';
import type { Database } from '../database/database.js';
import type { Logger } from '../logger/logger.js';
import type { TransactionManager } from '../transaction/transaction-manager.js';

/** The topic exchange all domain events are published to. */
export const EVENTS_EXCHANGE = 'nile.events';

const MAX_BACKOFF_SECONDS = 300;
const PUBLISH_TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 1_000;

export interface OutboxRelayOptions {
  batchSize: number;
  /** After this many failed attempts an event is no longer retried (it stays for inspection). */
  maxAttempts: number;
}

export interface RelayResult {
  published: number;
  failed: number;
}

interface OutboxRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
  correlation_id: string | null;
  occurred_at: Date;
  attempts: number;
}

/** The message body consumers receive: self-describing, independent of AMQP properties. */
export interface EventEnvelope {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  correlationId: string | null;
  payload: unknown;
}

/**
 * Moves committed outbox events to the message broker. Each batch runs in one transaction:
 * rows are locked with FOR UPDATE SKIP LOCKED (so concurrent relays never take the same event),
 * published, then marked as published or scheduled for retry with exponential backoff.
 *
 * Delivery is at-least-once: if the process dies after publishing but before COMMIT, the events
 * are published again. Consumers must deduplicate by message ID. Ordering is best-effort.
 */
export class OutboxRelay {
  constructor(
    private readonly db: Database,
    private readonly transactions: TransactionManager,
    private readonly publisher: MessagePublisher,
    private readonly logger: Logger,
    private readonly options: OutboxRelayOptions,
  ) {}

  relayBatch(): Promise<RelayResult> {
    return this.transactions.run(async () => {
      const { rows } = await this.db.query<OutboxRow>(
        `SELECT id, aggregate_type, aggregate_id::text, event_type, payload, correlation_id,
                occurred_at, attempts
         FROM outbox_events
         WHERE published_at IS NULL AND attempts < $1 AND next_attempt_at <= now()
         ORDER BY id
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [this.options.maxAttempts, this.options.batchSize],
      );
      if (rows.length === 0) return { published: 0, failed: 0 };

      const outcomes = await Promise.allSettled(rows.map((row) => this.publish(row)));

      const publishedIds: string[] = [];
      let failed = 0;
      for (const [index, outcome] of outcomes.entries()) {
        const row = rows[index] as OutboxRow;
        if (outcome.status === 'fulfilled') {
          publishedIds.push(row.id);
        } else {
          failed++;
          await this.scheduleRetry(row, outcome.reason);
        }
      }

      if (publishedIds.length > 0) {
        await this.db.query(
          'UPDATE outbox_events SET published_at = now() WHERE id = ANY($1::uuid[])',
          [publishedIds],
        );
      }

      return { published: publishedIds.length, failed };
    });
  }

  private publish(row: OutboxRow): Promise<void> {
    // Logs written while publishing carry the correlation ID of the request that caused the event.
    return runWithCorrelationId(row.correlation_id ?? generateCorrelationId(), () =>
      withTimeout(this.publisher.publish(toMessage(row)), PUBLISH_TIMEOUT_MS),
    );
  }

  private async scheduleRetry(row: OutboxRow, reason: unknown): Promise<void> {
    const attempts = row.attempts + 1;
    const message = (reason instanceof Error ? reason.message : String(reason)).slice(
      0,
      MAX_ERROR_LENGTH,
    );

    await this.db.query(
      `UPDATE outbox_events
       SET attempts = $2::int,
           last_error = $3,
           next_attempt_at = now() + make_interval(secs => least(power(2, $2::int), $4::int))
       WHERE id = $1`,
      [row.id, attempts, message, MAX_BACKOFF_SECONDS],
    );

    const context = {
      err: reason,
      eventId: row.id,
      eventType: row.event_type,
      attempts,
      correlationId: row.correlation_id,
    };
    if (attempts >= this.options.maxAttempts) {
      this.logger.error(context, 'Outbox event exhausted its publish attempts; giving up');
    } else {
      this.logger.warn(context, 'Outbox event publish failed; will retry');
    }
  }
}

function toEnvelope(row: OutboxRow): EventEnvelope {
  return {
    id: row.id,
    type: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    occurredAt: row.occurred_at.toISOString(),
    correlationId: row.correlation_id,
    payload: row.payload,
  };
}

function toMessage(row: OutboxRow): OutgoingMessage {
  return {
    id: row.id,
    routingKey: row.event_type,
    type: row.event_type,
    body: toEnvelope(row),
    timestamp: row.occurred_at,
    correlationId: row.correlation_id ?? undefined,
    headers: { 'x-aggregate-type': row.aggregate_type, 'x-aggregate-id': row.aggregate_id },
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Publish timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
