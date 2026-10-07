import { z } from 'zod';
import { type Config, configSchema } from './config.schema.js';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * Validates environment variables and returns a deeply frozen configuration.
 *
 * Call once per process at startup (composition root) and inject the result; do not call it
 * from application code. Throws ConfigError listing every invalid variable, without values.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(withoutEmptyValues(env));

  if (!result.success) {
    throw new ConfigError(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }

  return deepFreeze(result.data);
}

/** Treats `VAR=` the same as an unset variable so defaults apply. */
function withoutEmptyValues(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1].trim() !== '',
    ),
  );
}

function deepFreeze<T extends object>(value: T): T {
  for (const nested of Object.values(value)) {
    if (typeof nested === 'object' && nested !== null) {
      deepFreeze(nested);
    }
  }
  return Object.freeze(value);
}
