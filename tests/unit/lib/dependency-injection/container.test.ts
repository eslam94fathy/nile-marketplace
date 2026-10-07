import { inject, injectable } from 'tsyringe';
import { describe, expect, it } from 'vitest';
import type { Config } from '../../../../src/lib/config/config.schema.js';
import { loadConfig } from '../../../../src/lib/config/load-config.js';
import { buildContainer } from '../../../../src/lib/dependency-injection/container.js';
import { TOKENS } from '../../../../src/lib/dependency-injection/tokens.js';
import type { Logger } from '../../../../src/lib/logger/logger.js';

const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://nile:nile@localhost:5432/nile_test',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://nile:nile@localhost:5672',
});

const build = () => buildContainer({ config, processName: 'test' });

@injectable()
class ServiceWithExplicitTokens {
  constructor(
    @inject(TOKENS.Config) readonly config: Config,
    @inject(TOKENS.Logger) readonly logger: Logger,
  ) {}
}

// The next two classes deliberately violate the rule (enforced by ESLint) to pin down runtime behavior.

@injectable()
class ServiceMissingInjectToken {
  // eslint-disable-next-line no-restricted-syntax
  constructor(readonly logger: Logger) {}
}

@injectable()
class ServicePartiallyMissingToken {
  constructor(
    @inject(TOKENS.Config) readonly config: Config,
    // eslint-disable-next-line no-restricted-syntax
    readonly logger: Logger,
  ) {}
}

describe('buildContainer', () => {
  it.each(Object.entries(TOKENS))('resolves the %s token', (_name, token) => {
    expect(build().resolve(token)).toBeDefined();
  });

  it('registers the provided config instance', () => {
    expect(build().resolve(TOKENS.Config)).toBe(config);
  });

  it('registers a single logger instance named after the process', () => {
    const container = build();
    const logger = container.resolve<Logger>(TOKENS.Logger);

    expect(container.resolve(TOKENS.Logger)).toBe(logger);
    expect(logger.bindings()).toMatchObject({ name: 'test' });
    expect(logger.level).toBe('silent');
  });

  it('returns isolated containers on each call', () => {
    const first = build();
    const second = build();

    first.register(TOKENS.Config, { useValue: { overridden: true } });

    expect(second.resolve(TOKENS.Config)).toBe(config);
  });

  describe('explicit @inject(TOKEN) rule', () => {
    it('injects constructor parameters by token', () => {
      const container = build();

      const service = container.resolve(ServiceWithExplicitTokens);

      expect(service.config).toBe(config);
      expect(service.logger).toBe(container.resolve(TOKENS.Logger));
    });

    it('fails loudly when a parameter has no @inject token', () => {
      expect(() => build().resolve(ServiceMissingInjectToken)).toThrow();
    });

    // Why the rule is enforced by ESLint rather than at runtime: tsyringe does not detect a
    // trailing parameter without a token and silently passes undefined.
    it('does NOT detect a missing token on a trailing parameter at runtime', () => {
      const service = build().resolve(ServicePartiallyMissingToken);

      expect(service.config).toBe(config);
      expect(service.logger).toBeUndefined();
    });
  });
});
