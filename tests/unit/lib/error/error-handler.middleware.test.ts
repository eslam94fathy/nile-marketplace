import express, { type Express } from 'express';
import pg from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { correlationMiddleware } from '../../../../src/lib/correlation/correlation.middleware.js';
import { PG_ERROR } from '../../../../src/lib/database/errors.js';
import { errorHandler } from '../../../../src/lib/error/error-handler.middleware.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../../../src/lib/error/errors.js';
import { notFoundMiddleware } from '../../../../src/lib/error/not-found.middleware.js';
import { captureLogger } from '../../../support/capture-logger.js';

/** Mirrors createApp(): correlation first, JSON parser, routes, 404, then the error handler. */
function testApp(route: (app: Express) => void) {
  const { logger, lines } = captureLogger();
  const app = express();
  app.use(correlationMiddleware());
  app.use(express.json({ limit: '1kb' }));
  route(app);
  app.use(notFoundMiddleware());
  app.use(errorHandler(logger));
  return { app, lines };
}

function throwing(error: unknown) {
  return testApp((app) => {
    app.get('/boom', () => {
      throw error;
    });
  });
}

describe('errorHandler', () => {
  it.each([
    [new ValidationError(), 400, 'VALIDATION_FAILED'],
    [new UnauthenticatedError(), 401, 'UNAUTHENTICATED'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new NotFoundError(), 404, 'NOT_FOUND'],
    [new ConflictError(), 409, 'CONFLICT'],
    [new BusinessRuleError(), 422, 'BUSINESS_RULE_VIOLATION'],
  ])('responds to %o with %i and the standard shape', async (error, status, code) => {
    const { app } = throwing(error);

    const response = await request(app).get('/boom').set('X-Correlation-ID', 'corr-err-1');

    expect(response.status).toBe(status);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({
      error: { code, message: error.message, correlationId: 'corr-err-1' },
    });
  });

  it('includes details for client errors', async () => {
    const details = [{ path: 'email', message: 'Invalid email' }];
    const { app } = throwing(new ValidationError('Invalid input', { details }));

    const response = await request(app).get('/boom');

    expect(response.body.error.details).toEqual(details);
  });

  it('uses module-specific codes', async () => {
    const { app } = throwing(
      new NotFoundError('Product p-1 was not found', { code: 'PRODUCT_NOT_FOUND' }),
    );

    const response = await request(app).get('/boom');

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
      message: 'Product p-1 was not found',
    });
  });

  it('handles rejected promises from async handlers', async () => {
    const { app } = testApp((a) => {
      a.get('/async', async () => {
        await Promise.resolve();
        throw new ConflictError('Already exists');
      });
    });

    const response = await request(app).get('/async');

    expect(response.status).toBe(409);
    expect(response.body.error.message).toBe('Already exists');
  });

  describe('internal errors', () => {
    it('masks unknown errors and logs them with the stack and correlation ID', async () => {
      const { app, lines } = throwing(new TypeError('secret: connection string postgres://u:p@h'));

      const response = await request(app).get('/boom').set('X-Correlation-ID', 'corr-500');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          correlationId: 'corr-500',
        },
      });
      expect(JSON.stringify(response.body)).not.toContain('postgres://');

      const logged = lines.find((line) => line.level === 'error');
      expect(logged).toMatchObject({ correlationId: 'corr-500', status: 500 });
      expect(JSON.stringify(logged)).toContain('secret: connection string');
      expect(JSON.stringify(logged)).toContain('TypeError');
    });

    it('never exposes an InternalError message or details', async () => {
      const { app } = throwing(new InternalError('db is down', { details: { host: 'db-1' } }));

      const response = await request(app).get('/boom');

      expect(response.body.error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        correlationId: expect.any(String),
      });
    });

    it('handles non-Error throwables', async () => {
      const { app } = throwing('just a string');

      const response = await request(app).get('/boom');

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('request body errors', () => {
    function echo() {
      return testApp((app) => {
        app.post('/echo', (req, res) => {
          res.json(req.body);
        });
      });
    }

    it('rejects malformed JSON with 400 MALFORMED_JSON', async () => {
      const response = await request(echo().app)
        .post('/echo')
        .set('Content-Type', 'application/json')
        .send('{"broken": ');

      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({
        code: 'MALFORMED_JSON',
        message: 'The request body is not valid JSON',
      });
    });

    it('rejects oversized bodies with 413', async () => {
      const response = await request(echo().app)
        .post('/echo')
        .send({ data: 'x'.repeat(2048) });

      expect(response.status).toBe(413);
      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('rejects unsupported charsets with 415', async () => {
      const response = await request(echo().app)
        .post('/echo')
        .set('Content-Type', 'application/json; charset=klingon')
        .send('{}');

      expect(response.status).toBe(415);
      expect(response.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });
  });

  describe('untranslated database errors', () => {
    it('responds 409 without leaking the constraint, and logs a warning', async () => {
      const dbError = new pg.DatabaseError('duplicate key value', 0, 'error');
      dbError.code = PG_ERROR.UNIQUE_VIOLATION;
      dbError.constraint = 'users_email_key';
      const { app, lines } = throwing(dbError);

      const response = await request(app).get('/boom');

      expect(response.status).toBe(409);
      expect(JSON.stringify(response.body)).not.toContain('users_email_key');
      expect(lines.find((line) => line.level === 'warn')).toBeDefined();
    });
  });

  it('logs client errors at debug level only, without a stack trace', async () => {
    const { app, lines } = throwing(new NotFoundError('Product p-1 was not found'));

    await request(app).get('/boom').set('X-Correlation-ID', 'debug-1');

    expect(lines).toEqual([
      expect.objectContaining({
        level: 'debug',
        code: 'NOT_FOUND',
        status: 404,
        message: 'Product p-1 was not found',
        correlationId: 'debug-1',
      }),
    ]);
    expect(lines[0]).not.toHaveProperty('err');
  });

  it('aborts the connection and logs when the response was already started', async () => {
    const { app, lines } = testApp((a) => {
      a.get('/partial', (_req, res, next) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.write('partial');
        next(new Error('failed mid-stream'));
      });
    });

    const outcome = await request(app)
      .get('/partial')
      .set('X-Correlation-ID', 'mid-stream-1')
      .then(
        () => 'completed',
        (err: { code?: string }) => err.code,
      );

    // The client must not mistake the truncated response for a success.
    expect(outcome).toBe('ECONNRESET');
    expect(lines).toEqual([
      expect.objectContaining({
        level: 'error',
        correlationId: 'mid-stream-1',
        msg: 'Request failed after the response was started',
      }),
    ]);
  });
});

describe('notFoundMiddleware', () => {
  it('responds 404 ROUTE_NOT_FOUND for unmatched routes', async () => {
    const { app } = testApp(() => {});

    const response = await request(app).delete('/nothing/here').set('X-Correlation-ID', 'nf-1');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Route DELETE /nothing/here not found',
        correlationId: 'nf-1',
      },
    });
  });
});
