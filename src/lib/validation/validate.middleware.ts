import type { RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { InternalError, ValidationError } from '../error/errors.js';

export const REQUEST_LOCATIONS = ['params', 'query', 'body'] as const;
export type RequestLocation = (typeof REQUEST_LOCATIONS)[number];

export type RequestSchemas = Partial<Record<RequestLocation, z.ZodType>>;

/** Parsed (coerced, defaulted, unknown keys stripped) values for each validated location. */
export type ValidatedRequest<S extends RequestSchemas> = {
  [K in keyof S]: S[K] extends z.ZodType ? z.output<S[K]> : never;
};

export interface ValidationIssue {
  location: RequestLocation;
  /** Dot-separated path inside the location, e.g. "items.0.quantity"; empty for the root. */
  path: string;
  message: string;
  code: string;
}

const VALIDATED = Symbol('validated');

type ValidatedLocals = { [VALIDATED]?: { schemas: RequestSchemas; values: unknown } };

/**
 * Validates request params, query and body at the HTTP boundary. Every location is checked and
 * all issues are reported together as a ValidationError (400) with `details: ValidationIssue[]`.
 *
 * Usage:
 *   const schemas = { params: z.object({ id: z.uuid() }), body: UpdateProductBody };
 *   router.patch('/:id', validate(schemas), (req, res) => {
 *     const { params, body } = validated(res, schemas);
 *   });
 */
export function validate<S extends RequestSchemas>(schemas: S): RequestHandler {
  return (req, res, next) => {
    const values: Record<string, unknown> = {};
    const issues: ValidationIssue[] = [];

    for (const location of REQUEST_LOCATIONS) {
      const schema = schemas[location];
      if (!schema) continue;

      const result = schema.safeParse(req[location]);
      if (result.success) {
        values[location] = result.data;
      } else {
        issues.push(
          ...result.error.issues.map((issue) => ({
            location,
            path: issue.path.map(String).join('.'),
            message: issue.message,
            code: issue.code,
          })),
        );
      }
    }

    if (issues.length > 0) {
      next(new ValidationError('Request validation failed', { details: issues }));
      return;
    }

    (res.locals as ValidatedLocals)[VALIDATED] = { schemas, values };
    next();
  };
}

/**
 * Returns the values parsed by `validate(schemas)` for this request, typed from the same schemas.
 * Throws if `validate` with these schemas did not run first (a wiring bug, hence 500).
 */
export function validated<S extends RequestSchemas>(
  res: Response,
  schemas: S,
): ValidatedRequest<S> {
  const entry = (res.locals as ValidatedLocals)[VALIDATED];
  if (entry?.schemas !== schemas) {
    throw new InternalError('validated() called without matching validate() middleware');
  }
  return entry.values as ValidatedRequest<S>;
}
