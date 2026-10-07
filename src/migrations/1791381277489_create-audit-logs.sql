-- Up Migration

-- Append-only record of sensitive business and security actions (who did what, to what, when).
CREATE TABLE audit_logs (
  id             uuid        PRIMARY KEY DEFAULT uuidv7(),
  actor_type     text        NOT NULL CHECK (actor_type IN ('user', 'system', 'anonymous')),
  actor_id       uuid,
  action         text        NOT NULL CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  entity_type    text,
  entity_id      uuid,
  metadata       jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  correlation_id text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- A user actor is always identified; system and anonymous actors never are.
  CONSTRAINT audit_logs_actor_check
    CHECK ((actor_type = 'user') = (actor_id IS NOT NULL)),
  -- The target entity is optional, but type and id go together.
  CONSTRAINT audit_logs_entity_check
    CHECK ((entity_type IS NULL) = (entity_id IS NULL))
);

CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX audit_logs_created_at_idx ON audit_logs (created_at DESC);

-- Audit history must not be rewritten: reject UPDATE and DELETE for every role.
-- TRUNCATE remains available as an explicit administrative operation.
CREATE FUNCTION audit_logs_prevent_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% is not allowed)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_prevent_modification();

-- Down Migration

DROP TABLE audit_logs;
DROP FUNCTION audit_logs_prevent_modification();
