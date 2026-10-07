import type { RequestHandler } from 'express';
import {
  generateCorrelationId,
  isValidCorrelationId,
  runWithCorrelationId,
} from './correlation-context.js';

export const CORRELATION_ID_HEADER = 'X-Correlation-ID';

/**
 * Uses the incoming X-Correlation-ID when it is well-formed, otherwise generates one. Echoes it
 * in the response and runs the rest of the request inside its correlation context.
 *
 * Must be the first middleware so every later middleware and handler sees the ID.
 */
export function correlationMiddleware(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get(CORRELATION_ID_HEADER);
    const correlationId = isValidCorrelationId(incoming) ? incoming : generateCorrelationId();

    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    runWithCorrelationId(correlationId, next);
  };
}
