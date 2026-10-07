import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { PG_ERROR, type PgErrorCode } from '../../../../src/lib/database/errors.js';
import { AppError, ERROR_CATEGORY } from '../../../../src/lib/error/app-error.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  PayloadTooLargeError,
  UnauthenticatedError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '../../../../src/lib/error/errors.js';
import { normalizeError } from '../../../../src/lib/error/normalize-error.js';

function pgError(code: PgErrorCode, constraint?: string): Error {
  const err = new pg.DatabaseError('duplicate key value violates unique constraint', 0, 'error');
  err.code = code;
  err.constraint = constraint;
  return err;
}

function httpError(status: number, type?: string, expose = status < 500): Error {
  return Object.assign(new Error('http error'), { status, statusCode: status, type, expose });
}

describe('AppError subclasses', () => {
  it.each([
    [ValidationError, ERROR_CATEGORY.VALIDATION, 'VALIDATION_FAILED'],
    [UnauthenticatedError, ERROR_CATEGORY.UNAUTHENTICATED, 'UNAUTHENTICATED'],
    [ForbiddenError, ERROR_CATEGORY.FORBIDDEN, 'FORBIDDEN'],
    [NotFoundError, ERROR_CATEGORY.NOT_FOUND, 'NOT_FOUND'],
    [ConflictError, ERROR_CATEGORY.CONFLICT, 'CONFLICT'],
    [PayloadTooLargeError, ERROR_CATEGORY.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE'],
    [UnsupportedMediaTypeError, ERROR_CATEGORY.UNSUPPORTED_MEDIA_TYPE, 'UNSUPPORTED_MEDIA_TYPE'],
    [BusinessRuleError, ERROR_CATEGORY.BUSINESS_RULE, 'BUSINESS_RULE_VIOLATION'],
    [InternalError, ERROR_CATEGORY.INTERNAL, 'INTERNAL_ERROR'],
  ])('%o has category %s and default code %s', (ErrorClass, category, code) => {
    const error = new ErrorClass();

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.category).toBe(category);
    expect(error.code).toBe(code);
    expect(error.name).toBe(ErrorClass.name);
    expect(error.message).not.toBe('');
  });

  it('exposes client errors but never internal ones', () => {
    expect(new NotFoundError().expose).toBe(true);
    expect(new InternalError('db password is hunter2').expose).toBe(false);
  });

  it('supports module-specific subclasses with their own code', () => {
    class ProductNotFoundError extends NotFoundError {
      constructor(productId: string) {
        super(`Product ${productId} was not found`, { code: 'PRODUCT_NOT_FOUND' });
      }
    }

    const error = new ProductNotFoundError('p-1');

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.name).toBe('ProductNotFoundError');
    expect(error.code).toBe('PRODUCT_NOT_FOUND');
    expect(error.category).toBe(ERROR_CATEGORY.NOT_FOUND);
  });

  it('keeps details and cause', () => {
    const cause = new Error('root');
    const error = new ValidationError('Invalid', { details: [{ path: 'email' }], cause });

    expect(error.details).toEqual([{ path: 'email' }]);
    expect(error.cause).toBe(cause);
  });
});

describe('normalizeError', () => {
  it('returns AppErrors unchanged', () => {
    const error = new ConflictError();

    expect(normalizeError(error)).toBe(error);
  });

  describe('HTTP layer errors', () => {
    it('maps malformed JSON to a validation error', () => {
      const error = normalizeError(httpError(400, 'entity.parse.failed'));

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.code).toBe('MALFORMED_JSON');
    });

    it('maps oversized bodies to payload-too-large', () => {
      expect(normalizeError(httpError(413, 'entity.too.large'))).toBeInstanceOf(
        PayloadTooLargeError,
      );
    });

    it.each(['encoding.unsupported', 'charset.unsupported'])('maps %s to 415', (type) => {
      expect(normalizeError(httpError(415, type))).toBeInstanceOf(UnsupportedMediaTypeError);
    });

    it('maps other exposed 4xx HTTP errors to a generic bad request', () => {
      const error = normalizeError(httpError(400, 'request.aborted'));

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.code).toBe('BAD_REQUEST');
    });

    it('treats 5xx HTTP errors as internal', () => {
      expect(normalizeError(httpError(503))).toBeInstanceOf(InternalError);
    });
  });

  describe('database errors (fallback when a repository did not translate them)', () => {
    it.each([PG_ERROR.UNIQUE_VIOLATION, PG_ERROR.FOREIGN_KEY_VIOLATION])(
      'maps %s to a generic conflict without exposing the constraint',
      (code) => {
        const original = pgError(code, 'users_email_key');

        const error = normalizeError(original);

        expect(error).toBeInstanceOf(ConflictError);
        expect(error.code).toBe('CONFLICT');
        expect(error.message).not.toContain('users_email_key');
        expect(error.cause).toBe(original);
      },
    );

    it.each([PG_ERROR.SERIALIZATION_FAILURE, PG_ERROR.DEADLOCK_DETECTED])(
      'maps %s to a retryable conflict',
      (code) => {
        const error = normalizeError(pgError(code));

        expect(error).toBeInstanceOf(ConflictError);
        expect(error.code).toBe('CONCURRENT_MODIFICATION');
      },
    );

    it.each([PG_ERROR.CHECK_VIOLATION, PG_ERROR.NOT_NULL_VIOLATION])(
      'treats %s as internal (input validation should have caught it)',
      (code) => {
        expect(normalizeError(pgError(code))).toBeInstanceOf(InternalError);
      },
    );
  });

  it('wraps unknown errors as internal and keeps the original as cause', () => {
    const original = new TypeError("Cannot read properties of undefined (reading 'id')");

    const error = normalizeError(original);

    expect(error).toBeInstanceOf(InternalError);
    expect(error.cause).toBe(original);
    expect(error.expose).toBe(false);
  });

  it('wraps non-Error throwables as internal', () => {
    expect(normalizeError('a string')).toBeInstanceOf(InternalError);
    expect(normalizeError(undefined)).toBeInstanceOf(InternalError);
    expect(normalizeError({ status: 400 })).toBeInstanceOf(InternalError);
  });
});
