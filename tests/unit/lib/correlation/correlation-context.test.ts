import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import {
  generateCorrelationId,
  getCorrelationId,
  isValidCorrelationId,
  runWithCorrelationId,
} from '../../../../src/lib/correlation/correlation-context.js';

describe('correlation context', () => {
  it('is undefined outside a context', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('exposes the ID inside a context and returns the callback result', () => {
    const result = runWithCorrelationId('corr-1', () => getCorrelationId());

    expect(result).toBe('corr-1');
    expect(getCorrelationId()).toBeUndefined();
  });

  it('propagates across await, timers and promise combinators', async () => {
    const seen = await runWithCorrelationId('corr-async', async () => {
      await delay(5);
      const viaTimer = await new Promise<string | undefined>((resolve) =>
        setTimeout(() => resolve(getCorrelationId()), 5),
      );
      const viaAll = await Promise.all([1, 2].map(async () => getCorrelationId()));
      return [getCorrelationId(), viaTimer, ...viaAll];
    });

    expect(seen).toEqual(['corr-async', 'corr-async', 'corr-async', 'corr-async']);
  });

  it('isolates concurrent contexts', async () => {
    const run = (id: string, wait: number) =>
      runWithCorrelationId(id, async () => {
        await delay(wait);
        return getCorrelationId();
      });

    expect(await Promise.all([run('a', 20), run('b', 5), run('c', 10)])).toEqual(['a', 'b', 'c']);
  });

  it('lets a nested context override and then restore the outer one', () => {
    runWithCorrelationId('outer', () => {
      expect(runWithCorrelationId('inner', () => getCorrelationId())).toBe('inner');
      expect(getCorrelationId()).toBe('outer');
    });
  });

  describe('isValidCorrelationId', () => {
    it.each(['abc', 'ABC-123_xyz', generateCorrelationId(), 'a'.repeat(128)])(
      'accepts %s',
      (id) => {
        expect(isValidCorrelationId(id)).toBe(true);
      },
    );

    it.each([
      ['empty', ''],
      ['too long', 'a'.repeat(129)],
      ['spaces', 'abc def'],
      ['newline (log forging)', 'abc\ninjected'],
      ['header injection', 'abc\r\nSet-Cookie: x=1'],
      ['special characters', 'abc;<script>'],
      ['non-string', 123],
      ['undefined', undefined],
    ])('rejects %s', (_label, value) => {
      expect(isValidCorrelationId(value)).toBe(false);
    });
  });

  it('generates valid, unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, generateCorrelationId));

    expect(ids.size).toBe(100);
    for (const id of ids) expect(isValidCorrelationId(id)).toBe(true);
  });
});
