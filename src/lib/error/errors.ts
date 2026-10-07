import { AppError, type AppErrorOptions, ERROR_CATEGORY } from './app-error.js';

/**
 * Generic error classes. Modules extend these for specific cases, e.g.
 * `class ProductNotFoundError extends NotFoundError` with code "PRODUCT_NOT_FOUND".
 */

export class ValidationError extends AppError {
  readonly category = ERROR_CATEGORY.VALIDATION;
  constructor(message = 'The request is invalid', options?: AppErrorOptions) {
    super(message, 'VALIDATION_FAILED', options);
  }
}

export class UnauthenticatedError extends AppError {
  readonly category = ERROR_CATEGORY.UNAUTHENTICATED;
  constructor(message = 'Authentication is required', options?: AppErrorOptions) {
    super(message, 'UNAUTHENTICATED', options);
  }
}

export class ForbiddenError extends AppError {
  readonly category = ERROR_CATEGORY.FORBIDDEN;
  constructor(message = 'You are not allowed to perform this action', options?: AppErrorOptions) {
    super(message, 'FORBIDDEN', options);
  }
}

export class NotFoundError extends AppError {
  readonly category = ERROR_CATEGORY.NOT_FOUND;
  constructor(message = 'The requested resource was not found', options?: AppErrorOptions) {
    super(message, 'NOT_FOUND', options);
  }
}

export class ConflictError extends AppError {
  readonly category = ERROR_CATEGORY.CONFLICT;
  constructor(message = 'The request conflicts with the current state', options?: AppErrorOptions) {
    super(message, 'CONFLICT', options);
  }
}

export class PayloadTooLargeError extends AppError {
  readonly category = ERROR_CATEGORY.PAYLOAD_TOO_LARGE;
  constructor(message = 'The request body is too large', options?: AppErrorOptions) {
    super(message, 'PAYLOAD_TOO_LARGE', options);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  readonly category = ERROR_CATEGORY.UNSUPPORTED_MEDIA_TYPE;
  constructor(message = 'The request body encoding is not supported', options?: AppErrorOptions) {
    super(message, 'UNSUPPORTED_MEDIA_TYPE', options);
  }
}

/** A valid request that breaks a business rule, e.g. publishing a product without variants. */
export class BusinessRuleError extends AppError {
  readonly category = ERROR_CATEGORY.BUSINESS_RULE;
  constructor(message = 'The request violates a business rule', options?: AppErrorOptions) {
    super(message, 'BUSINESS_RULE_VIOLATION', options);
  }
}

/** Unexpected failure. Its message is logged but never returned to clients. */
export class InternalError extends AppError {
  readonly category = ERROR_CATEGORY.INTERNAL;
  constructor(message = 'Internal server error', options?: AppErrorOptions) {
    super(message, 'INTERNAL_ERROR', options);
  }
}
