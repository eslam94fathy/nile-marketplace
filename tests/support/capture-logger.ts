import { Writable } from 'node:stream';
import { getCorrelationId } from '../../src/lib/correlation/correlation-context.js';
import { createLogger, type Logger, type LoggerOptions } from '../../src/lib/logger/logger.js';

export type LogLine = Record<string, unknown>;

/** A real logger whose JSON output is collected into `lines` for assertions. */
export function captureLogger(options: Partial<LoggerOptions> = {}): {
  logger: Logger;
  lines: LogLine[];
} {
  const lines: LogLine[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as LogLine);
      callback();
    },
  });

  const logger = createLogger(
    { name: 'test', level: 'trace', pretty: false, getCorrelationId, ...options },
    destination,
  );

  return { logger, lines };
}
