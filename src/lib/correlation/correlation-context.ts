import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface CorrelationContext {
  readonly correlationId: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

/** Accepted format for externally supplied correlation IDs (header injection, log forging). */
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value);
}

export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Runs `fn` with the given correlation ID available to everything it calls, synchronously or
 * asynchronously. Used per HTTP request and, in the worker, per processed message.
 */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

/**
 * Runs `fn` outside any correlation context. For infrastructure events that a request merely
 * triggered (e.g. a lazy connection becoming ready), so their logs are not attributed to it.
 */
export function withoutCorrelation<T>(fn: () => T): T {
  return storage.exit(fn);
}

/** The current correlation ID, or undefined outside any request/message context. */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
