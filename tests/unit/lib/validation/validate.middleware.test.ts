import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { errorHandler } from '../../../../src/lib/error/error-handler.middleware.js';
import { validate, validated } from '../../../../src/lib/validation/validate.middleware.js';
import { captureLogger } from '../../../support/capture-logger.js';

const createItemSchemas = {
  params: z.object({ listId: z.uuid() }),
  query: z.object({
    dryRun: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  }),
  body: z.object({
    name: z.string().trim().min(1),
    quantity: z.number().int().positive(),
    tags: z.array(z.string()).default([]),
  }),
};

const listSchemas = {
  query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
};

const LIST_ID = '0199b3c4-0000-7000-8000-000000000001';

function testApp(): Express {
  const app = express();
  app.use(express.json());
  app.post('/lists/:listId/items', validate(createItemSchemas), (_req, res) => {
    res.json(validated(res, createItemSchemas));
  });
  app.get('/items', validate(listSchemas), (_req, res) => {
    res.json(validated(res, listSchemas));
  });
  app.get('/unvalidated', (_req, res) => {
    res.json(validated(res, listSchemas));
  });
  app.get('/mismatched', validate(listSchemas), (_req, res) => {
    res.json(validated(res, createItemSchemas));
  });
  app.use(errorHandler(captureLogger({ level: 'silent' }).logger));
  return app;
}

describe('validate / validated', () => {
  it('passes parsed, transformed values to the handler', async () => {
    const response = await request(testApp())
      .post(`/lists/${LIST_ID}/items?dryRun=true`)
      .send({ name: '  Coffee  ', quantity: 2 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      params: { listId: LIST_ID },
      query: { dryRun: true },
      body: { name: 'Coffee', quantity: 2, tags: [] },
    });
  });

  it('coerces and defaults query parameters', async () => {
    const defaults = await request(testApp()).get('/items');
    const explicit = await request(testApp()).get('/items?limit=50');

    expect(defaults.body).toEqual({ query: { limit: 20 } });
    expect(explicit.body).toEqual({ query: { limit: 50 } });
  });

  it('strips unknown keys so clients cannot inject extra fields', async () => {
    const response = await request(testApp())
      .post(`/lists/${LIST_ID}/items`)
      .send({ name: 'Tea', quantity: 1, sellerId: 'attacker', isAdmin: true });

    expect(response.body.body).toEqual({ name: 'Tea', quantity: 1, tags: [] });
  });

  it('rejects invalid input with 400 and reports issues from every location at once', async () => {
    const response = await request(testApp())
      .post('/lists/not-a-uuid/items?dryRun=maybe')
      .set('X-Correlation-ID', 'val-1')
      .send({ name: '', quantity: 1.5, tags: ['ok', 3] });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
    });
    const issues = response.body.error.details as { location: string; path: string }[];
    expect(issues.map(({ location, path }) => `${location}:${path}`).sort()).toEqual([
      'body:name',
      'body:quantity',
      'body:tags.1',
      'params:listId',
      'query:dryRun',
    ]);
    for (const issue of response.body.error.details as Record<string, unknown>[]) {
      expect(issue).toEqual({
        location: expect.any(String),
        path: expect.any(String),
        message: expect.any(String),
        code: expect.any(String),
      });
    }
  });

  it('reports missing required fields', async () => {
    const response = await request(testApp()).post(`/lists/${LIST_ID}/items`).send({});

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ location: 'body', path: 'name', code: 'invalid_type' }),
        expect.objectContaining({ location: 'body', path: 'quantity', code: 'invalid_type' }),
      ]),
    );
  });

  it('rejects a request without a JSON body', async () => {
    const response = await request(testApp()).post(`/lists/${LIST_ID}/items`);

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([
      expect.objectContaining({ location: 'body', path: '', code: 'invalid_type' }),
    ]);
  });

  it('rejects out-of-range coerced query values', async () => {
    const response = await request(testApp()).get('/items?limit=1000');

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([
      expect.objectContaining({ location: 'query', path: 'limit', code: 'too_big' }),
    ]);
  });

  describe('wiring mistakes', () => {
    it('responds 500 when validated() is used without validate()', async () => {
      const response = await request(testApp()).get('/unvalidated');

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
    });

    it('responds 500 when validated() is given different schemas than validate()', async () => {
      const response = await request(testApp()).get('/mismatched');

      expect(response.status).toBe(500);
    });
  });

  it('infers handler types from the schemas', () => {
    type Result = ReturnType<typeof validated<typeof createItemSchemas>>;

    expectTypeOf<Result['params']>().toEqualTypeOf<{ listId: string }>();
    expectTypeOf<Result['query']>().toEqualTypeOf<{ dryRun: boolean }>();
    expectTypeOf<Result['body']>().toEqualTypeOf<{
      name: string;
      quantity: number;
      tags: string[];
    }>();
    expectTypeOf<ReturnType<typeof validated<typeof listSchemas>>>().toEqualTypeOf<{
      query: { limit: number };
    }>();
  });
});
