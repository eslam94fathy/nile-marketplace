import type { ErrorRequestHandler } from 'express';
import { getCorrelationId } from '../correlation/correlation-context.js';
import { isPgError } from '../database/errors.js';
import type { Logger } from '../logger/logger.js';
import { type AppError, ERROR_CATEGORY, type ErrorCategory } from './app-error.js';
import { normalizeError } from './normalize-error.js';

export const HTTP_STATUS_BY_CATEGORY: Record<ErrorCategory, number> = {
  [ERROR_CATEGORY.VALIDATION]: 400,
  [ERROR_CATEGORY.UNAUTHENTICATED]: 401,
  [ERROR_CATEGORY.FORBIDDEN]: 403,
  [ERROR_CATEGORY.NOT_FOUND]: 404,
  [ERROR_CATEGORY.CONFLICT]: 409,
  [ERROR_CATEGORY.PAYLOAD_TOO_LARGE]: 413,
  [ERROR_CATEGORY.UNSUPPORTED_MEDIA_TYPE]: 415,
  [ERROR_CATEGORY.BUSINESS_RULE]: 422,
  [ERROR_CATEGORY.INTERNAL]: 500,
};

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    correlationId?: string;
  };
}

/**
 * The single place errors become HTTP responses. Controllers do not catch errors; they let them
 * propagate here (Express 5 forwards rejected promises automatically). Must be registered last.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    if (res.headersSent) {
      // Too late for a JSON error. Abort the connection so the client sees a truncated response
      // rather than a success, as Express would, but log through our logger: Express's default
      // handler would print the raw stack to stderr without redaction or correlation ID.
      logger.error({ err }, 'Request failed after the response was started');
      req.socket.destroy();
      return;
    }

    const error = normalizeError(err);
    const status = HTTP_STATUS_BY_CATEGORY[error.category];
    log(logger, error, status);

    const body: ErrorResponseBody = {
      error: {
        code: error.code,
        message: error.expose ? error.message : 'Internal server error',
        ...(error.expose && error.details !== undefined ? { details: error.details } : {}),
        correlationId: getCorrelationId(),
      },
    };
    res.status(status).json(body);
  };
}

function log(logger: Logger, error: AppError, status: number): void {
  const context = { err: error, code: error.code, status };

  if (status >= 500) {
    logger.error(context, 'Request failed');
  } else if (isPgError(error.cause)) {
    // A repository let a database constraint error escape instead of translating it.
    logger.warn(context, 'Untranslated database error mapped to client error');
  } else {
    logger.debug(context, 'Request rejected');
  }
}
