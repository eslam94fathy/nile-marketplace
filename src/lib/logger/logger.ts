import { type DestinationStream, type Logger as PinoLogger, pino } from 'pino';
import type { Config } from '../config/config.schema.js';

export type Logger = PinoLogger;

export interface LoggerOptions {
  /** Process role, added to every line (e.g. "api", "worker"). */
  name: string;
  level: Config['log']['level'];
  /** Human-readable output. Development only: it runs a transport worker thread. */
  pretty: boolean;
  /** Supplies the current request's correlation ID, if any (wired to lib/correlation). */
  getCorrelationId?: () => string | undefined;
}

const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'authorization',
  'cookie',
];

/**
 * Paths redacted from every log line. Wildcards match one level only, so sensitive values
 * nested deeper must not be logged at all.
 */
export const REDACTED_PATHS = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((key) => `*.${key}`),
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * Creates the process logger. Call once in the composition root and inject it;
 * use `logger.child({...})` for component-scoped context.
 *
 * `destination` is for tests; it is ignored when `pretty` is enabled.
 */
export function createLogger(options: LoggerOptions, destination?: DestinationStream): Logger {
  const { getCorrelationId } = options;

  const pinoOptions = {
    name: options.name,
    level: options.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    redact: { paths: REDACTED_PATHS, censor: REDACTED_PLACEHOLDER },
    mixin: () => {
      const correlationId = getCorrelationId?.();
      return correlationId ? { correlationId } : {};
    },
  };

  if (options.pretty) {
    return pino({
      ...pinoOptions,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      },
    });
  }

  return destination ? pino(pinoOptions, destination) : pino(pinoOptions);
}
