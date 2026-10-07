import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { getCorrelationId } from '../../../../src/lib/correlation/correlation-context.js';
import {
  CORRELATION_ID_HEADER,
  correlationMiddleware,
} from '../../../../src/lib/correlation/correlation.middleware.js';
import { createLogger } from '../../../../src/lib/logger/logger.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Same middleware order as createApp(): correlation first, then the JSON body parser. */
function testApp(): Express {
  const app = express();
  app.use(correlationMiddleware());
  app.use(express.json());
  app.get('/sync', (_req, res) => {
    res.json({ seen: getCorrelationId() });
  });
  app.get('/async', async (_req, res) => {
    await delay(10);
    res.json({ seen: getCorrelationId() });
  });
  app.post('/body', (req, res) => {
    res.json({ seen: getCorrelationId(), body: req.body as unknown });
  });
  return app;
}

describe('correlationMiddleware', () => {
  it('preserves a valid incoming X-Correlation-ID', async () => {
    const response = await request(testApp()).get('/sync').set(CORRELATION_ID_HEADER, 'abc-123');

    expect(response.headers['x-correlation-id']).toBe('abc-123');
    expect(response.body).toEqual({ seen: 'abc-123' });
  });

  it('generates a UUID when the header is missing', async () => {
    const response = await request(testApp()).get('/sync');

    const id = response.headers['x-correlation-id'];
    expect(id).toMatch(UUID);
    expect(response.body).toEqual({ seen: id });
  });

  it.each([
    ['too long', 'a'.repeat(129)],
    ['invalid characters', 'abc;<script>'],
    ['spaces', 'abc def'],
  ])('replaces a malformed header (%s) with a generated ID', async (_label, value) => {
    const response = await request(testApp()).get('/sync').set(CORRELATION_ID_HEADER, value);

    expect(response.headers['x-correlation-id']).toMatch(UUID);
    expect(response.headers['x-correlation-id']).not.toBe(value);
  });

  it('keeps the ID across async work in the handler', async () => {
    const response = await request(testApp()).get('/async').set(CORRELATION_ID_HEADER, 'async-1');

    expect(response.body).toEqual({ seen: 'async-1' });
  });

  it('keeps the ID after the JSON body parser has read the request stream', async () => {
    const response = await request(testApp())
      .post('/body')
      .set(CORRELATION_ID_HEADER, 'body-1')
      .send({ hello: 'world' });

    expect(response.body).toEqual({ seen: 'body-1', body: { hello: 'world' } });
  });

  it('isolates concurrent requests', async () => {
    const app = testApp();
    const ids = Array.from({ length: 20 }, (_, i) => `concurrent-${i}`);

    const responses = await Promise.all(
      ids.map((id) => request(app).get('/async').set(CORRELATION_ID_HEADER, id)),
    );

    expect(responses.map((r) => (r.body as { seen: string }).seen)).toEqual(ids);
  });

  it('adds the request correlation ID to log lines written in the handler', async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger(
      { name: 'test', level: 'info', pretty: false, getCorrelationId },
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
          callback();
        },
      }),
    );
    const app = express();
    app.use(correlationMiddleware());
    app.get('/log', async (_req, res) => {
      await delay(5);
      logger.info('handled');
      res.end();
    });

    await request(app).get('/log').set(CORRELATION_ID_HEADER, 'log-1');

    expect(lines).toEqual([expect.objectContaining({ msg: 'handled', correlationId: 'log-1' })]);
  });
});
