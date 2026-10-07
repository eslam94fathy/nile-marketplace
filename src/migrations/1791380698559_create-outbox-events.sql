-- Up Migration

-- Transactional outbox: events are written in the same transaction as the business change and
-- relayed to the message broker afterwards by the worker (at-least-once delivery).
CREATE TABLE outbox_events (
  id              uuid        PRIMARY KEY DEFAULT uuidv7(),
  aggregate_type  text        NOT NULL,
  aggregate_id    uuid        NOT NULL,
  event_type      text        NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  payload         jsonb       NOT NULL,
  correlation_id  text,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  attempts        integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error      text,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);

-- The relay only scans unpublished events that are due, oldest first.
CREATE INDEX outbox_events_pending_idx
  ON outbox_events (next_attempt_at, id)
  WHERE published_at IS NULL;

-- Down Migration

DROP TABLE outbox_events;