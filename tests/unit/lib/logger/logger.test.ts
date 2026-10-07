import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createLogger,
  REDACTED_PLACEHOLDER,
  type LoggerOptions,
} from '../../../../src/lib/logger/logger.js';

type LogLine = Record<string, unknown>;

function captureLogger(options: Partial<LoggerOptions> = {}) {
  const lines: LogLine[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as LogLine);
      callback();
    },
  });

  const logger = createLogger(
    { name: 'test', level: 'trace', pretty: false, ...options },
    destination,
  );

  return { logger, lines };
}

describe('createLogger', () => {
  describe('output format', () => {
    it('writes JSON lines with name, level label, ISO time and message', () => {
      const { logger, lines } = captureLogger({ name: 'api' });

      logger.info({ orderId: 'o-1' }, 'order placed');

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        name: 'api',
        level: 'info',
        msg: 'order placed',
        orderId: 'o-1',
      });
      expect(new Date(lines[0]?.time as string).toISOString()).toBe(lines[0]?.time);
    });

    it('respects the configured level', () => {
      const { logger, lines } = captureLogger({ level: 'warn' });

      logger.info('hidden');
      logger.warn('shown');

      expect(lines.map((line) => line.msg)).toEqual(['shown']);
    });

    it('serializes errors under err with message and stack', () => {
      const { logger, lines } = captureLogger();

      logger.error({ err: new Error('boom') }, 'failed');

      expect(lines[0]?.err).toMatchObject({ type: 'Error', message: 'boom' });
      expect((lines[0]?.err as LogLine).stack).toEqual(expect.any(String));
    });
  });

  describe('redaction', () => {
    it.each(['password', 'passwordHash', 'token', 'accessToken', 'refreshToken', 'secret'])(
      'redacts top-level %s',
      (key) => {
        const { logger, lines } = captureLogger();

        logger.info({ [key]: 'sensitive-value' }, 'event');

        expect(lines[0]?.[key]).toBe(REDACTED_PLACEHOLDER);
        expect(JSON.stringify(lines[0])).not.toContain('sensitive-value');
      },
    );

    it('redacts sensitive keys one level deep', () => {
      const { logger, lines } = captureLogger();

      logger.info({ user: { email: 'a@b.c', password: 'hunter2' } }, 'register');

      expect(lines[0]?.user).toEqual({ email: 'a@b.c', password: REDACTED_PLACEHOLDER });
    });

    it('redacts request authorization and cookie headers', () => {
      const { logger, lines } = captureLogger();

      logger.info(
        {
          req: {
            method: 'GET',
            headers: { authorization: 'Bearer abc.def.ghi', cookie: 'sid=xyz', accept: '*/*' },
          },
        },
        'request',
      );

      expect((lines[0]?.req as { headers: LogLine }).headers).toEqual({
        authorization: REDACTED_PLACEHOLDER,
        cookie: REDACTED_PLACEHOLDER,
        accept: '*/*',
      });
    });

    it('redacts set-cookie response headers', () => {
      const { logger, lines } = captureLogger();

      logger.info({ res: { headers: { 'set-cookie': 'sid=xyz' } } }, 'response');

      expect((lines[0]?.res as { headers: LogLine }).headers['set-cookie']).toBe(
        REDACTED_PLACEHOLDER,
      );
    });

    it('applies redaction to child loggers', () => {
      const { logger, lines } = captureLogger();

      logger.child({ component: 'auth' }).info({ password: 'hunter2' }, 'login');

      expect(lines[0]).toMatchObject({ component: 'auth', password: REDACTED_PLACEHOLDER });
    });
  });

  describe('correlation ID', () => {
    it('adds correlationId from the provider to every line', () => {
      const { logger, lines } = captureLogger({ getCorrelationId: () => 'corr-123' });

      logger.info('first');
      logger.child({ component: 'db' }).warn('second');

      expect(lines.map((line) => line.correlationId)).toEqual(['corr-123', 'corr-123']);
    });

    it('reads the correlation ID at log time, not at creation time', () => {
      let current: string | undefined = 'corr-a';
      const { logger, lines } = captureLogger({ getCorrelationId: () => current });

      logger.info('a');
      current = 'corr-b';
      logger.info('b');

      expect(lines.map((line) => line.correlationId)).toEqual(['corr-a', 'corr-b']);
    });

    it('omits correlationId when there is no active context', () => {
      const { logger, lines } = captureLogger({ getCorrelationId: () => undefined });

      logger.info('background');

      expect(lines[0]).not.toHaveProperty('correlationId');
    });

    it('omits correlationId when no provider is configured', () => {
      const { logger, lines } = captureLogger();

      logger.info('no provider');

      expect(lines[0]).not.toHaveProperty('correlationId');
    });
  });
});
