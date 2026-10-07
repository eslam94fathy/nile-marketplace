import { z } from 'zod';
import { ValidationError } from '../error/errors.js';

/**
 * Keyset (cursor) pagination.
 *
 * A cursor is an opaque base64url string holding the sort it belongs to and the position of the
 * last row returned: its sort key and its id (the tie-breaker). Repositories query with
 *
 *   WHERE (sort_key, id) < ($key, $id) ORDER BY sort_key DESC, id DESC LIMIT $limit + 1
 *
 * Chronological lists should sort by `id` alone: primary keys are uuidv7 (time-ordered), so no
 * timestamp is needed. Use a `z.null()` key schema and `WHERE id < $id ORDER BY id DESC`.
 *
 * Timestamp keys must round-trip exactly. PostgreSQL stores microseconds but a JS Date holds only
 * milliseconds, so a Date-based cursor silently skips rows. Select the key as text in SQL
 * (see TIMESTAMP_CURSOR_KEY_SQL) and validate it with `timestampCursorKey`.
 *
 * Cursors are not signed: a forged cursor only changes the starting position, and authorization
 * filters always live in the SQL, never in the cursor.
 */

export interface CursorPosition<K> {
  key: K;
  id: string;
}

export interface CursorCodec<K> {
  encode(position: CursorPosition<K>): string;
  /** Throws ValidationError (400, INVALID_CURSOR) for malformed, tampered or foreign cursors. */
  decode(cursor: string): CursorPosition<K>;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Creates a codec for one sort order. `sort` names the order (e.g. "price_asc"); a cursor from a
 * different sort is rejected. `keySchema` validates the decoded sort key before it reaches SQL.
 */
export function createCursorCodec<K>(sort: string, keySchema: z.ZodType<K>): CursorCodec<K> {
  const payloadSchema = z.object({
    s: z.literal(sort),
    k: keySchema,
    id: z.uuid(),
  });

  return {
    encode({ key, id }) {
      return Buffer.from(JSON.stringify({ s: sort, k: key, id }), 'utf8').toString('base64url');
    },

    decode(cursor) {
      if (!BASE64URL.test(cursor)) throw invalidCursor();

      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      } catch {
        throw invalidCursor();
      }

      const result = payloadSchema.safeParse(payload);
      if (!result.success) throw invalidCursor();

      return { key: result.data.k as K, id: result.data.id };
    },
  };
}

/**
 * A UTC ISO-8601 timestamp with exactly microsecond precision, e.g. "2026-10-07T13:30:00.123456Z",
 * that is a real calendar date (so casting it to timestamptz in SQL cannot fail).
 */
export const timestampCursorKey = z.iso.datetime({ precision: 6 }).refine((value) => {
  const millis = Date.parse(value);
  return (
    Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 23) === value.slice(0, 23)
  );
});

/**
 * SQL expression producing a `timestampCursorKey` from a timestamptz column.
 * `column` must be a trusted identifier written in code, never request input.
 */
export const TIMESTAMP_CURSOR_KEY_SQL = (column: string): string =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function invalidCursor(): ValidationError {
  return new ValidationError('The pagination cursor is invalid', { code: 'INVALID_CURSOR' });
}
