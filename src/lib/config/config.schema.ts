import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);
const positiveInt = z.coerce.number().int().positive();
const nonEmpty = z.string().min(1);

/**
 * Raw environment variables accepted by the application.
 * Connections are configured per component (host, port, credentials); the URLs drivers need are
 * built here. Error messages must never include values: passwords are secrets.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: port.default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  POSTGRES_HOST: nonEmpty,
  POSTGRES_PORT: port.default(5432),
  POSTGRES_USER: nonEmpty,
  POSTGRES_PASSWORD: nonEmpty,
  POSTGRES_DB: nonEmpty,
  DB_POOL_MAX: positiveInt.max(100).default(10),

  REDIS_HOST: nonEmpty,
  REDIS_PORT: port.default(6379),
  REDIS_PASSWORD: nonEmpty.optional(),
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),
  REDIS_TLS: z.stringbool().default(false),

  RABBITMQ_HOST: nonEmpty,
  RABBITMQ_PORT: port.default(5672),
  RABBITMQ_USER: nonEmpty,
  RABBITMQ_PASSWORD: nonEmpty,
  RABBITMQ_VHOST: nonEmpty.optional(),
  RABBITMQ_TLS: z.stringbool().default(false),

  WORKER_HEALTH_PORT: port.default(3001),

  OUTBOX_POLL_INTERVAL_MS: positiveInt.default(1000),
  OUTBOX_BATCH_SIZE: positiveInt.max(1000).default(50),
  OUTBOX_MAX_ATTEMPTS: positiveInt.default(10),
});

type Env = z.output<typeof envSchema>;

/** Maps validated environment variables to the application's configuration shape. */
export const configSchema = envSchema.transform((env) => ({
  nodeEnv: env.NODE_ENV,
  http: {
    port: env.PORT,
  },
  worker: {
    /** Health endpoints of the worker process (it serves no other HTTP). */
    healthPort: env.WORKER_HEALTH_PORT,
  },
  log: {
    level: env.LOG_LEVEL,
  },
  db: {
    url: postgresUrl(env),
    poolMax: env.DB_POOL_MAX,
  },
  redis: {
    url: redisUrl(env),
  },
  rabbitmq: {
    url: rabbitMqUrl(env),
  },
  outbox: {
    pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
    batchSize: env.OUTBOX_BATCH_SIZE,
    maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
  },
}));

export type Config = DeepReadonly<z.output<typeof configSchema>>;

type DeepReadonly<T> = { readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K] };

// Credentials and names are percent-encoded so characters such as "@", ":" or "/" stay literal.
const enc = encodeURIComponent;

function postgresUrl(env: Env): string {
  return `postgres://${enc(env.POSTGRES_USER)}:${enc(env.POSTGRES_PASSWORD)}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${enc(env.POSTGRES_DB)}`;
}

function redisUrl(env: Env): string {
  const scheme = env.REDIS_TLS ? 'rediss' : 'redis';
  const auth = env.REDIS_PASSWORD === undefined ? '' : `:${enc(env.REDIS_PASSWORD)}@`;
  return `${scheme}://${auth}${env.REDIS_HOST}:${env.REDIS_PORT}/${env.REDIS_DB}`;
}

function rabbitMqUrl(env: Env): string {
  const scheme = env.RABBITMQ_TLS ? 'amqps' : 'amqp';
  const vhost = env.RABBITMQ_VHOST === undefined ? '' : `/${enc(env.RABBITMQ_VHOST)}`;
  return `${scheme}://${enc(env.RABBITMQ_USER)}:${enc(env.RABBITMQ_PASSWORD)}@${env.RABBITMQ_HOST}:${env.RABBITMQ_PORT}${vhost}`;
}
