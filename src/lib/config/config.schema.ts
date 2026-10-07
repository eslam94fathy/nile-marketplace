import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);
const positiveInt = z.coerce.number().int().positive();

/**
 * Raw environment variables accepted by the application.
 * Error messages must never include values: URLs carry credentials.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: port.default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' }),
  DB_POOL_MAX: positiveInt.max(100).default(10),

  REDIS_URL: z.url({ protocol: /^rediss?$/, error: 'must be a redis:// or rediss:// URL' }),

  RABBITMQ_URL: z.url({ protocol: /^amqps?$/, error: 'must be an amqp:// or amqps:// URL' }),

  OUTBOX_POLL_INTERVAL_MS: positiveInt.default(1000),
  OUTBOX_BATCH_SIZE: positiveInt.max(1000).default(50),
  OUTBOX_MAX_ATTEMPTS: positiveInt.default(10),
});

/** Maps validated environment variables to the application's configuration shape. */
export const configSchema = envSchema.transform((env) => ({
  nodeEnv: env.NODE_ENV,
  http: {
    port: env.PORT,
  },
  log: {
    level: env.LOG_LEVEL,
  },
  db: {
    url: env.DATABASE_URL,
    poolMax: env.DB_POOL_MAX,
  },
  redis: {
    url: env.REDIS_URL,
  },
  rabbitmq: {
    url: env.RABBITMQ_URL,
  },
  outbox: {
    pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
    batchSize: env.OUTBOX_BATCH_SIZE,
    maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
  },
}));

export type Config = DeepReadonly<z.output<typeof configSchema>>;

type DeepReadonly<T> = { readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K] };
