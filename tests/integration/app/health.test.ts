import type { DependencyContainer } from 'tsyringe';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import {
  closeTestContainer,
  createTestContainer,
  type TestContainerOptions,
} from '../../support/test-container.js';

describe('health endpoints', () => {
  const containers: DependencyContainer[] = [];

  function app(options?: TestContainerOptions) {
    const container = createTestContainer(options);
    containers.push(container);
    return createApp(container);
  }

  afterEach(async () => {
    await Promise.all(containers.splice(0).map(closeTestContainer));
  });

  describe('GET /health/live', () => {
    it('responds 200 without touching dependencies', async () => {
      const response = await request(
        app({ config: { db: { url: 'postgres://nile:nile@127.0.0.1:1/nile' } } }),
      ).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
      expect(response.headers['cache-control']).toBe('no-store');
    });
  });

  describe('GET /health/ready', () => {
    it('responds 200 when PostgreSQL and Redis are reachable', async () => {
      const response = await request(app()).get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        status: 'ready',
        checks: {
          postgres: { status: 'up', latencyMs: expect.any(Number) },
          redis: { status: 'up', latencyMs: expect.any(Number) },
        },
      });
    });

    it('does not check RabbitMQ (the API never uses it)', async () => {
      const response = await request(app()).get('/health/ready');

      expect(Object.keys(response.body.checks)).toEqual(['postgres', 'redis']);
    });

    it('responds 503 when Redis is unreachable', async () => {
      const response = await request(
        app({ config: { redis: { url: 'redis://127.0.0.1:1/15' } } }),
      ).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('not_ready');
      expect(response.body.checks.postgres.status).toBe('up');
      expect(response.body.checks.redis).toMatchObject({ status: 'down' });
    });

    it('responds 503 when PostgreSQL is unreachable, without leaking connection details', async () => {
      const response = await request(
        app({ config: { db: { url: 'postgres://nile:nile@127.0.0.1:1/nile' } } }),
      ).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body.checks.postgres).toMatchObject({ status: 'down' });
      expect(response.body.checks.redis.status).toBe('up');
      expect(JSON.stringify(response.body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED/);
    });

    it('carries a correlation ID like every other response', async () => {
      const response = await request(app()).get('/health/ready').set('X-Correlation-ID', 'hc-1');

      expect(response.headers['x-correlation-id']).toBe('hc-1');
    });
  });
});
