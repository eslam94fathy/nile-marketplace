import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../../../src/lib/config/load-config.js';

const validEnv = {
  DATABASE_URL: 'postgres://nile:secret-db-pass@localhost:5432/nile',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://nile:secret-mq-pass@localhost:5672',
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
        log: { level: 'info' },
        db: { url: validEnv.DATABASE_URL, poolMax: 10 },
        redis: { url: validEnv.REDIS_URL },
        rabbitmq: { url: validEnv.RABBITMQ_URL },
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

    it('accepts postgresql://, rediss:// and amqps:// schemes', () => {
      expect(() =>
        loadConfig({
          DATABASE_URL: 'postgresql://u:p@db:5432/nile',
          REDIS_URL: 'rediss://cache:6380',
          RABBITMQ_URL: 'amqps://u:p@mq:5671',
        }),
      ).not.toThrow();
    });

    it('treats empty values as unset so defaults apply', () => {
      const config = loadConfig({ ...validEnv, PORT: '', LOG_LEVEL: '  ' });

      expect(config.http.port).toBe(3000);
      expect(config.log.level).toBe('info');
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

      expect(error.message).toContain('DATABASE_URL');
      expect(error.message).toContain('REDIS_URL');
      expect(error.message).toContain('RABBITMQ_URL');
    });

    it('reports a single missing variable', () => {
      const { REDIS_URL: _omitted, ...env } = validEnv;

      const error = loadError(env);

      expect(error.message).toContain('REDIS_URL');
      expect(error.message).not.toContain('DATABASE_URL');
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
      ['DATABASE_URL', 'not a url'],
      ['DATABASE_URL', 'mysql://u:p@localhost/nile'],
      ['REDIS_URL', 'http://localhost:6379'],
      ['RABBITMQ_URL', 'redis://localhost:5672'],
    ])('rejects %s=%s', (name, value) => {
      const error = loadError({ ...validEnv, [name]: value });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error.message).toContain(name);
    });

    it('never includes variable values (secrets) in the error message', () => {
      const error = loadError({
        ...validEnv,
        DATABASE_URL: 'mysql://nile:super-secret-pass@localhost/nile',
        PORT: 'not-a-number',
      });

      expect(error.message).not.toContain('super-secret-pass');
      expect(error.message).not.toContain('secret-mq-pass');
    });
  });
});
