import { z } from 'zod';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
export const MAX_CURSOR_LENGTH = 1024;

/**
 * Query parameters shared by every list endpoint. Modules extend it with their filters:
 *   const listProductsQuery = paginationQuerySchema.extend({ categoryId: z.uuid().optional() });
 */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
});

export type PaginationQuery = z.output<typeof paginationQuerySchema>;

/** The response shape of every list endpoint (blueprint §12). */
export interface Page<T> {
  data: T[];
  pagination: {
    nextCursor: string | null;
    hasNextPage: boolean;
  };
}

/**
 * Builds a page from rows fetched with `LIMIT limit + 1`: the extra row only signals that a next
 * page exists and is not returned. `toCursor` encodes the position of the last returned row.
 */
export function buildPage<Row>(
  rows: readonly Row[],
  limit: number,
  toCursor: (lastRow: Row) => string,
): Page<Row> {
  const hasNextPage = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data.at(-1);

  return {
    data,
    pagination: {
      nextCursor: hasNextPage && last !== undefined ? toCursor(last) : null,
      hasNextPage,
    },
  };
}

/** Maps page items (e.g. rows to response DTOs) while keeping the pagination metadata. */
export function mapPage<A, B>(page: Page<A>, fn: (item: A) => B): Page<B> {
  return { data: page.data.map(fn), pagination: page.pagination };
}
