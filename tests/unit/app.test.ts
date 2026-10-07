import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../support/test-container.js';

// Infrastructure clients connect lazily and these requests never reach them.
const app = () => createTestApp().app;

describe('createApp', () => {
  it('responds 404 with the standard error shape for unknown routes', async () => {
    const response = await request(app())
      .get('/api/v1/does-not-exist')
      .set('X-Correlation-ID', 'app-404');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Route GET /api/v1/does-not-exist not found',
        correlationId: 'app-404',
      },
    });
  });

  it('sets security headers and hides the framework', async () => {
    const response = await request(app()).get('/api/v1/does-not-exist');

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toBeDefined();
  });

  it('returns a correlation ID on every response', async () => {
    const preserved = await request(app())
      .get('/api/v1/does-not-exist')
      .set('X-Correlation-ID', 'app-level-1');
    const generated = await request(app()).get('/api/v1/does-not-exist');

    expect(preserved.headers['x-correlation-id']).toBe('app-level-1');
    expect(generated.headers['x-correlation-id']).toEqual(expect.any(String));
  });

  it('rejects JSON bodies over the size limit with 413', async () => {
    const response = await request(app())
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(101 * 1024) }));

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await request(app())
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MALFORMED_JSON');
  });
});
