import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../../../src/lib/config/load-config.js';

const validEnv = {
  POSTGRES_HOST: 'localhost',
  POSTGRES_USER: 'nile',
  POSTGRES_PASSWORD: 'secret-db-pass',
  POSTGRES_DB: 'nile',
  REDIS_HOST: 'localhost',
  RABBITMQ_HOST: 'localhost',
  RABBITMQ_USER: 'nile',
  RABBITMQ_PASSWORD: 'secret-mq-pass',
};

function loadError(env: NodeJS.ProcessEnv): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  describe('valid environment', () => {
    it('applies defaults for optional variables', () => {
      const config = loadConfig(validEnv);

      expect(config).toEqual({
        nodeEnv: 'development',
        http: { port: 3000 },
        worker: { healthPort: 3001 },
        log: { level: 'info' },
        db: { url: 'postgres://nile:secret-db-pass@localhost:5432/nile', poolMax: 10 },
        redis: { url: 'redis://localhost:6379/0' },
        rabbitmq: { url: 'amqp://nile:secret-mq-pass@localhost:5672' },
        outbox: { pollIntervalMs: 1000, batchSize: 50, maxAttempts: 10 },
      });
    });

    it('coerces numeric variables and reads explicit values', () => {
      const config = loadConfig({
        ...validEnv,
        NODE_ENV: 'production',
        PORT: '8080',
        LOG_LEVEL: 'warn',
        DB_POOL_MAX: '25',
        OUTBOX_POLL_INTERVAL_MS: '500',
        OUTBOX_BATCH_SIZE: '100',
        OUTBOX_MAX_ATTEMPTS: '5',
      });

      expect(config.nodeEnv).toBe('production');
      expect(config.http.port).toBe(8080);
      expect(config.log.level).toBe('warn');
      expect(config.db.poolMax).toBe(25);
      expect(config.outbox).toEqual({ pollIntervalMs: 500, batchSize: 100, maxAttempts: 5 });
    });

    it('builds connection URLs from host, port, credentials and options', () => {
      const config = loadConfig({
        ...validEnv,
        POSTGRES_HOST: 'db',
        POSTGRES_PORT: '6543',
        REDIS_HOST: 'cache',
        REDIS_PORT: '6380',
        REDIS_PASSWORD: 'redis-pass',
        REDIS_DB: '15',
        REDIS_TLS: 'true',
        RABBITMQ_HOST: 'mq',
        RABBITMQ_PORT: '5671',
        RABBITMQ_VHOST: 'nile',
        RABBITMQ_TLS: 'true',
      });

      expect(config.db.url).toBe('postgres://nile:secret-db-pass@db:6543/nile');
      expect(config.redis.url).toBe('rediss://:redis-pass@cache:6380/15');
      expect(config.rabbitmq.url).toBe('amqps://nile:secret-mq-pass@mq:5671/nile');
    });

    it('percent-encodes credentials, database and vhost names', () => {
      const config = loadConfig({
        ...validEnv,
        POSTGRES_USER: 'app@corp',
        POSTGRES_PASSWORD: 'p@ss:w/rd#?',
        POSTGRES_DB: 'my db',
        REDIS_PASSWORD: 'r@d:s',
        RABBITMQ_PASSWORD: 'm/q@',
        RABBITMQ_VHOST: '/',
      });

      expect(config.db.url).toBe(
        'postgres://app%40corp:p%40ss%3Aw%2Frd%23%3F@localhost:5432/my%20db',
      );
      expect(new URL(config.db.url).password).toBe('p%40ss%3Aw%2Frd%23%3F');
      expect(config.redis.url).toBe('redis://:r%40d%3As@localhost:6379/0');
      expect(config.rabbitmq.url).toBe('amqp://nile:m%2Fq%40@localhost:5672/%2F');
    });

    it('treats empty values as unset so defaults apply', () => {
      const config = loadConfig({ ...validEnv, PORT: '', LOG_LEVEL: '  ', REDIS_PASSWORD: '' });

      expect(config.http.port).toBe(3000);
      expect(config.log.level).toBe('info');
      expect(config.redis.url).toBe('redis://localhost:6379/0');
    });

    it('ignores unrelated environment variables', () => {
      const config = loadConfig({ ...validEnv, PATH: '/usr/bin', SOMETHING_ELSE: 'x' });

      expect(config).not.toHaveProperty('PATH');
    });

    it('returns a deeply frozen object', () => {
      const config = loadConfig(validEnv);

      expect(Object.isFrozen(config)).toBe(true);
      expect(Object.isFrozen(config.db)).toBe(true);
      expect(() => {
        (config.db as { url: string }).url = 'postgres://changed';
      }).toThrow(TypeError);
    });
  });

  describe('missing variables', () => {
    it('reports every missing required variable at once', () => {
      const error = loadError({});

      for (const name of Object.keys(validEnv)) {
        expect(error.message).toContain(name);
      }
    });

    it('reports a single missing variable', () => {
      const { REDIS_HOST: _omitted, ...env } = validEnv;

      const error = loadError(env);

      expect(error.message).toContain('REDIS_HOST');
      expect(error.message).not.toContain('POSTGRES_HOST');
    });
  });

  describe('invalid variables', () => {
    it.each([
      ['PORT', 'not-a-number'],
      ['PORT', '0'],
      ['PORT', '70000'],
      ['PORT', '30.5'],
      ['NODE_ENV', 'staging'],
      ['LOG_LEVEL', 'verbose'],
      ['DB_POOL_MAX', '0'],
      ['DB_POOL_MAX', '101'],
      ['OUTBOX_BATCH_SIZE', '-1'],
      ['POSTGRES_PORT', 'abc'],
      ['REDIS_PORT', '70000'],
      ['REDIS_DB', '16'],
      ['REDIS_TLS', 'maybe'],
      ['RABBITMQ_PORT', '0'],
      ['RABBITMQ_TLS', 'yes please'],
    ])('rejects %s=%s', (name, value) => {
      const error = loadError({ ...validEnv, [name]: value });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error.message).toContain(name);
    });

    it('never includes variable values (secrets) in the error message', () => {
      const error = loadError({
        ...validEnv,
        POSTGRES_PASSWORD: 'super-secret-pass',
        PORT: 'not-a-number',
        POSTGRES_PORT: 'super-secret-port',
      });

      expect(error.message).not.toContain('super-secret');
      expect(error.message).not.toContain('secret-mq-pass');
    });
  });
});
