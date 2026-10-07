import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

// The snippets are virtual files outside the TypeScript project, so type-aware rules are off;
// the rule under test is purely syntactic.
const eslint = new ESLint({ overrideConfig: tseslint.configs.disableTypeChecked });

async function violations(code: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath: 'src/lib/example.ts' });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax').length;
}

const header = `import { inject, injectable, singleton, scoped, Lifecycle } from 'tsyringe';
const A = Symbol('A');
const B = Symbol('B');
`;

describe('ESLint rule: explicit @inject(TOKEN) on DI constructor parameters', () => {
  it('accepts parameters that all use @inject', async () => {
    const code = `${header}
@injectable()
export class Service {
  constructor(@inject(A) readonly a: string, @inject(B) private readonly b: number) {}
}`;
    expect(await violations(code)).toBe(0);
  });

  it('accepts classes without constructor parameters', async () => {
    const code = `${header}
@injectable()
export class Service {
  run(): void {}
}`;
    expect(await violations(code)).toBe(0);
  });

  it('ignores classes that are not managed by tsyringe', async () => {
    const code = `${header}
export class ValueObject {
  constructor(readonly amount: number) {}
}`;
    expect(await violations(code)).toBe(0);
  });

  it.each([
    ['@injectable()', 'parameter property', 'readonly a: string'],
    ['@singleton()', 'plain parameter', 'a: string'],
    ['@scoped(Lifecycle.ContainerScoped)', 'parameter with default', 'a = 1'],
  ])('rejects a %s class with an undecorated %s', async (decorator, _kind, param) => {
    const code = `${header}
${decorator}
export class Service {
  constructor(${param}) { void a; }
}`;
    expect(await violations(code)).toBe(1);
  });

  it('rejects a trailing parameter without @inject (the case tsyringe misses at runtime)', async () => {
    const code = `${header}
@injectable()
export class Service {
  constructor(@inject(A) readonly a: string, readonly b: number) {}
}`;
    expect(await violations(code)).toBe(1);
  });
});
