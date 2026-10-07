import { isPgError, PG_ERROR } from '../database/errors.js';
import { AppError } from './app-error.js';
import {
  ConflictError,
  InternalError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from './errors.js';

/**
 * Converts anything thrown into an AppError. AppErrors pass through unchanged; everything else
 * is translated (keeping the original as `cause` for logging) or treated as internal.
 */
export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return fromHttpParserError(err) ?? fromDatabaseError(err) ?? internal(err);
}

/** Errors raised by Express and its body parsers (http-errors objects with a `type`). */
function fromHttpParserError(err: unknown): AppError | undefined {
  if (!isHttpError(err)) return undefined;
  const options = { cause: err };

  switch (err.type) {
    case 'entity.parse.failed':
      return new ValidationError('The request body is not valid JSON', {
        ...options,
        code: 'MALFORMED_JSON',
      });
    case 'entity.too.large':
      return new PayloadTooLargeError(undefined, options);
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new UnsupportedMediaTypeError(undefined, options);
  }

  // Other client errors from the HTTP layer (aborted request, malformed URI, ...).
  if (err.status >= 400 && err.status < 500 && err.expose === true) {
    return new ValidationError('The request is malformed', { ...options, code: 'BAD_REQUEST' });
  }
  return undefined;
}

/**
 * Fallback for database errors a repository did not translate into a domain error. Constraint
 * names and SQL messages stay in the logs, never in responses.
 */
function fromDatabaseError(err: unknown): AppError | undefined {
  if (isPgError(err, PG_ERROR.UNIQUE_VIOLATION) || isPgError(err, PG_ERROR.FOREIGN_KEY_VIOLATION)) {
    return new ConflictError(undefined, { cause: err });
  }
  if (
    isPgError(err, PG_ERROR.SERIALIZATION_FAILURE) ||
    isPgError(err, PG_ERROR.DEADLOCK_DETECTED)
  ) {
    return new ConflictError('The resource was modified concurrently; please retry', {
      cause: err,
      code: 'CONCURRENT_MODIFICATION',
    });
  }
  return undefined;
}

function internal(err: unknown): InternalError {
  return new InternalError(undefined, { cause: err });
}

interface HttpError {
  status: number;
  expose?: boolean;
  type?: string;
}

function isHttpError(err: unknown): err is HttpError {
  return err instanceof Error && typeof (err as Partial<HttpError>).status === 'number';
}
