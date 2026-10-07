import { describe, expect, it } from 'vitest';
import {
  buildPage,
  DEFAULT_PAGE_LIMIT,
  mapPage,
  MAX_PAGE_LIMIT,
  paginationQuerySchema,
} from '../../../../src/lib/pagination/pagination.js';

describe('paginationQuerySchema', () => {
  it('defaults limit to 20 and leaves cursor undefined', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: DEFAULT_PAGE_LIMIT });
  });

  it('coerces limit from the query string', () => {
    expect(paginationQuerySchema.parse({ limit: '50', cursor: 'abc' })).toEqual({
      limit: 50,
      cursor: 'abc',
    });
  });

  it.each(['0', '-1', '101', '2.5', 'ten'])('rejects limit=%s', (limit) => {
    expect(paginationQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it('accepts the maximum limit', () => {
    expect(paginationQuerySchema.parse({ limit: String(MAX_PAGE_LIMIT) }).limit).toBe(100);
  });

  it('rejects empty and oversized cursors', () => {
    expect(paginationQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ cursor: 'a'.repeat(1025) }).success).toBe(false);
  });

  it('can be extended with module filters', () => {
    const schema = paginationQuerySchema.extend({ status: paginationQuerySchema.shape.cursor });

    expect(schema.parse({ status: 'x' })).toEqual({ limit: 20, status: 'x' });
  });
});

describe('buildPage', () => {
  const toCursor = (row: { id: number }) => `cursor-${row.id}`;
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

  it('returns an empty last page', () => {
    expect(buildPage([], 10, toCursor)).toEqual({
      data: [],
      pagination: { nextCursor: null, hasNextPage: false },
    });
  });

  it('returns a last page when fewer rows than the limit were found', () => {
    expect(buildPage(rows(3), 10, toCursor)).toEqual({
      data: rows(3),
      pagination: { nextCursor: null, hasNextPage: false },
    });
  });

  it('returns a last page when exactly `limit` rows were found', () => {
    expect(buildPage(rows(10), 10, toCursor).pagination).toEqual({
      nextCursor: null,
      hasNextPage: false,
    });
  });

  it('drops the extra row and points the cursor at the last returned row', () => {
    const page = buildPage(rows(11), 10, toCursor);

    expect(page.data).toEqual(rows(10));
    expect(page.pagination).toEqual({ nextCursor: 'cursor-10', hasNextPage: true });
  });

  it('works with a limit of 1', () => {
    expect(buildPage(rows(2), 1, toCursor)).toEqual({
      data: [{ id: 1 }],
      pagination: { nextCursor: 'cursor-1', hasNextPage: true },
    });
  });
});

describe('mapPage', () => {
  it('maps items and keeps pagination metadata', () => {
    const page = {
      data: [{ id: 1 }, { id: 2 }],
      pagination: { nextCursor: 'c', hasNextPage: true },
    };

    expect(mapPage(page, (row) => `item-${row.id}`)).toEqual({
      data: ['item-1', 'item-2'],
      pagination: { nextCursor: 'c', hasNextPage: true },
    });
  });
});
