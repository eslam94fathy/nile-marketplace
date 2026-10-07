/**
 * Transport-independent error classification. Domain and application code choose a category;
 * only the presentation layer maps categories to HTTP status codes.
 */
export const ERROR_CATEGORY = {
  VALIDATION: 'VALIDATION',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  BUSINESS_RULE: 'BUSINESS_RULE',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCategory = (typeof ERROR_CATEGORY)[keyof typeof ERROR_CATEGORY];

export interface AppErrorOptions {
  /** Stable, machine-readable code, e.g. "PRODUCT_NOT_FOUND". Defaults per subclass. */
  code?: string;
  /** Safe, client-facing structured details (e.g. validation issues). Never internals. */
  details?: unknown;
  cause?: unknown;
}

/**
 * Base class for every error the application raises deliberately. Messages of non-INTERNAL
 * errors are returned to clients, so they must not contain internal details.
 */
export abstract class AppError extends Error {
  abstract readonly category: ErrorCategory;
  readonly code: string;
  readonly details: unknown;

  protected constructor(message: string, defaultCode: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code ?? defaultCode;
    this.details = options.details;
  }

  /** Whether the message may be shown to clients. Internal errors are always masked. */
  get expose(): boolean {
    return this.category !== ERROR_CATEGORY.INTERNAL;
  }
}
