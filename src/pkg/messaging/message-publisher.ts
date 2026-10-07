/**
 * Transport-agnostic publishing port. Independent library code: must not import app/ or lib/.
 */

export interface OutgoingMessage {
  /** Unique, stable message ID. Consumers use it to discard duplicates (at-least-once delivery). */
  id: string;
  /** Routing key / topic, e.g. "seller.approved". */
  routingKey: string;
  /** Message type name, usually equal to the routing key. */
  type: string;
  /** Serialized as JSON. */
  body: unknown;
  timestamp: Date;
  correlationId?: string;
  headers?: Record<string, string>;
}

export interface MessagePublisher {
  /** Resolves once the broker has durably accepted the message; rejects otherwise. */
  publish(message: OutgoingMessage): Promise<void>;
  /** Verifies the broker is reachable (used by readiness checks). */
  ping(): Promise<void>;
  close(): Promise<void>;
}
