import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

describe('createApp', () => {
  it('responds 404 to unknown routes', async () => {
    const response = await request(createApp()).get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
  });

  it('sets security headers and hides the framework', async () => {
    const response = await request(createApp()).get('/api/v1/does-not-exist');

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toBeDefined();
  });

  it('returns a correlation ID on every response, including 404s', async () => {
    const preserved = await request(createApp())
      .get('/api/v1/does-not-exist')
      .set('X-Correlation-ID', 'app-level-1');
    const generated = await request(createApp()).get('/api/v1/does-not-exist');

    expect(preserved.headers['x-correlation-id']).toBe('app-level-1');
    expect(generated.headers['x-correlation-id']).toEqual(expect.any(String));
  });

  it('rejects JSON bodies over the size limit with 413', async () => {
    const oversized = { data: 'x'.repeat(101 * 1024) };

    const response = await request(createApp())
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(oversized));

    expect(response.status).toBe(413);
  });
});
