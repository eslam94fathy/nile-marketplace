import type { RequestHandler } from 'express';
import { NotFoundError } from './errors.js';

/** Registered after all routes: any request that reaches it matched no route. */
export function notFoundMiddleware(): RequestHandler {
  return (req, _res, next) => {
    next(
      new NotFoundError(`Route ${req.method} ${req.path} not found`, { code: 'ROUTE_NOT_FOUND' }),
    );
  };
}
