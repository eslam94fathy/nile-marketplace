import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationError } from '../../../../src/lib/error/errors.js';
import { createCursorCodec, timestampCursorKey } from '../../../../src/lib/pagination/cursor.js';

const ID = '0199b3c4-1a2b-7c3d-8e4f-0123456789ab';

const byId = createCursorCodec('id_desc', z.null());
const byPrice = createCursorCodec('price_asc', z.string().regex(/^\d+$/));
const byPublishedAt = createCursorCodec('published_at_desc', timestampCursorKey);

function b64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeError(decode: () => unknown): ValidationError {
  try {
    decode();
  } catch (err) {
    if (err instanceof ValidationError) return err;
    throw err;
  }
  throw new Error('expected decode to throw');
}

describe('createCursorCodec', () => {
  it('round-trips an id-only position', () => {
    const cursor = byId.encode({ key: null, id: ID });

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(byId.decode(cursor)).toEqual({ key: null, id: ID });
  });

  it('round-trips a bigint-as-string key', () => {
    expect(byPrice.decode(byPrice.encode({ key: '125000', id: ID }))).toEqual({
      key: '125000',
      id: ID,
    });
  });

  it('round-trips a microsecond timestamp key', () => {
    const position = { key: '2026-10-07T13:30:00.123456Z', id: ID };

    expect(byPublishedAt.decode(byPublishedAt.encode(position))).toEqual(position);
  });

  it('produces opaque cursors that do not read as plain JSON', () => {
    expect(byPrice.encode({ key: '100', id: ID })).not.toContain('{');
  });

  describe('rejects bad cursors with 400 INVALID_CURSOR', () => {
    it.each([
      ['non-base64url characters', 'abc+/=='],
      ['whitespace', 'abc def'],
      ['base64url that is not JSON', b64('not json')],
      ['JSON of the wrong shape', b64(JSON.stringify({ hello: 'world' }))],
      ['a JSON primitive', b64('42')],
      ['an id that is not a UUID', b64(JSON.stringify({ s: 'price_asc', k: '1', id: '1 OR 1=1' }))],
      ['a key failing the key schema', b64(JSON.stringify({ s: 'price_asc', k: 'abc', id: ID }))],
      ['a key of the wrong type', b64(JSON.stringify({ s: 'price_asc', k: 5, id: ID }))],
    ])('%s', (_label, cursor) => {
      const error = decodeError(() => byPrice.decode(cursor));

      expect(error.code).toBe('INVALID_CURSOR');
      expect(error.message).toBe('The pagination cursor is invalid');
    });

    it('a cursor created for a different sort order', () => {
      const priceCursor = byPrice.encode({ key: '100', id: ID });

      expect(decodeError(() => byPublishedAt.decode(priceCursor)).code).toBe('INVALID_CURSOR');
    });
  });
});

describe('timestampCursorKey', () => {
  it('accepts UTC ISO timestamps with microsecond precision', () => {
    expect(timestampCursorKey.safeParse('2026-10-07T13:30:00.123456Z').success).toBe(true);
    expect(timestampCursorKey.safeParse('2028-02-29T00:00:00.000000Z').success).toBe(true);
  });

  it.each([
    ['millisecond precision (loses rows)', '2026-10-07T13:30:00.123Z'],
    ['no fraction', '2026-10-07T13:30:00Z'],
    ['offset instead of Z', '2026-10-07T13:30:00.123456+03:00'],
    ['impossible month', '2026-13-01T00:00:00.000000Z'],
    ['impossible day', '2026-02-30T00:00:00.000000Z'],
    ['non-leap-year Feb 29', '2026-02-29T00:00:00.000000Z'],
    ['SQL', "2026-10-07'; DROP TABLE x; --"],
  ])('rejects %s', (_label, value) => {
    expect(timestampCursorKey.safeParse(value).success).toBe(false);
  });
});
