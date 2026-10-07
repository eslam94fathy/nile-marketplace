-- Up Migration
CREATE TABLE migration_probe (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE migration_probe;