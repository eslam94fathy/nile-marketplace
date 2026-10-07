import { createRequire } from 'node:module';
import { cruise, type ICruiseResult, type IConfiguration } from 'dependency-cruiser';
import extractTSConfig from 'dependency-cruiser/config-utl/extract-ts-config';

const require = createRequire(import.meta.url);
const configuration = require('../../.dependency-cruiser.cjs') as IConfiguration;

export interface Violation {
  rule: string;
  from: string;
  to: string;
}

/**
 * Runs the project's dependency-cruiser rules through the programmatic API (which, unlike the
 * CLI, works on every Node version) and returns the violations found.
 */
export async function findArchitectureViolations(paths: string[]): Promise<Violation[]> {
  const { options = {}, forbidden = [] } = configuration;
  const { tsConfig, enhancedResolveOptions, ...cruiseOptions } = options;

  const result = await cruise(
    paths,
    { ...cruiseOptions, ruleSet: { forbidden }, validate: true },
    enhancedResolveOptions,
    { tsConfig: extractTSConfig(tsConfig?.fileName ?? 'tsconfig.json') },
  );

  const output = result.output as ICruiseResult;
  return output.summary.violations.map((violation) => ({
    rule: violation.rule.name,
    from: violation.from,
    to: violation.to,
  }));
}
