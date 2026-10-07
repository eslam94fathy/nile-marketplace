import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Database } from '../../../../src/lib/database/database.js';
import {
  createCursorCodec,
  TIMESTAMP_CURSOR_KEY_SQL,
  timestampCursorKey,
} from '../../../../src/lib/pagination/cursor.js';
import { buildPage, type Page } from '../../../../src/lib/pagination/pagination.js';
import { createTestPool } from '../../support/test-database.js';

/**
 * Pages through real rows to prove keyset pagination returns every row exactly once, including
 * rows that differ only in microseconds and rows with identical sort keys.
 */
describe('keyset pagination against PostgreSQL', () => {
  let pool: Pool;
  let db: Database;
  const ROW_COUNT = 30;

  beforeAll(async () => {
    pool = createTestPool();
    db = new Database(pool);
    await db.query(`
      DROP TABLE IF EXISTS pagination_probe;
      CREATE TABLE pagination_probe (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        published_at timestamptz NOT NULL
      );
    `);
    // Groups of rows within the same millisecond (differing by microseconds) plus exact ties.
    await db.query(
      `INSERT INTO pagination_probe (published_at)
       SELECT timestamptz '2026-10-07 12:00:00.123000+00'
              + make_interval(secs => ((n % 10) * 100) / 1000000.0)
       FROM generate_series(1, $1) AS n`,
      [ROW_COUNT],
    );
  });

  afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS pagination_probe');
    await pool.end();
  });

  async function collectAll<Row>(
    fetchPage: (cursor: string | undefined) => Promise<Page<Row>>,
  ): Promise<Row[]> {
    const all: Row[] = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const page = await fetchPage(cursor);
      all.push(...page.data);
      if (!page.pagination.hasNextPage) return all;
      cursor = page.pagination.nextCursor ?? undefined;
    }
    throw new Error('pagination did not terminate');
  }

  it('sorts chronologically by uuidv7 id alone', async () => {
    const codec = createCursorCodec('id_desc', z.null());
    const limit = 7;

    const rows = await collectAll(async (cursor) => {
      const after = cursor ? codec.decode(cursor) : undefined;
      const result = await db.query<{ id: string }>(
        `SELECT id::text FROM pagination_probe
         WHERE $1::uuid IS NULL OR id < $1::uuid
         ORDER BY id DESC LIMIT $2`,
        [after?.id ?? null, limit + 1],
      );
      return buildPage(result.rows, limit, (row) => codec.encode({ key: null, id: row.id }));
    });

    const expected = await db.query<{ id: string }>(
      'SELECT id::text FROM pagination_probe ORDER BY id DESC',
    );
    expect(rows.map((r) => r.id)).toEqual(expected.rows.map((r) => r.id));
    expect(new Set(rows.map((r) => r.id)).size).toBe(ROW_COUNT);
  });

  it('pages by a microsecond timestamp key with ties, returning every row exactly once', async () => {
    const codec = createCursorCodec('published_at_desc', timestampCursorKey);
    const limit = 4;

    const rows = await collectAll(async (cursor) => {
      const after = cursor ? codec.decode(cursor) : undefined;
      const result = await db.query<{ id: string; key: string }>(
        `SELECT id::text, ${TIMESTAMP_CURSOR_KEY_SQL('published_at')} AS key
         FROM pagination_probe
         WHERE $1::timestamptz IS NULL OR (published_at, id) < ($1::timestamptz, $2::uuid)
         ORDER BY published_at DESC, id DESC
         LIMIT $3`,
        [after?.key ?? null, after?.id ?? null, limit + 1],
      );
      return buildPage(result.rows, limit, (row) => codec.encode({ key: row.key, id: row.id }));
    });

    const expected = await db.query<{ id: string }>(
      'SELECT id::text FROM pagination_probe ORDER BY published_at DESC, id DESC',
    );
    expect(rows.map((r) => r.id)).toEqual(expected.rows.map((r) => r.id));
  });

  // Documents why timestamp keys must not go through JS Date (millisecond precision).
  it('loses rows when the timestamp key is round-tripped through a JS Date', async () => {
    const limit = 4;
    const seen = new Set<string>();
    let after: { key: Date; id: string } | undefined;

    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const result = await db.query<{ id: string; published_at: Date }>(
        `SELECT id::text, published_at FROM pagination_probe
         WHERE $1::timestamptz IS NULL OR (published_at, id) < ($1::timestamptz, $2::uuid)
         ORDER BY published_at DESC, id DESC
         LIMIT $3`,
        [after?.key ?? null, after?.id ?? null, limit + 1],
      );
      const page = buildPage(result.rows, limit, () => '');
      for (const row of page.data) seen.add(row.id);
      const last = page.data.at(-1);
      if (!page.pagination.hasNextPage || !last) break;
      after = { key: last.published_at, id: last.id };
    }

    expect(seen.size).toBeLessThan(ROW_COUNT);
  });
});
