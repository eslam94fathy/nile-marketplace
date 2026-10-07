import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ADR-0001: every constructor parameter of a tsyringe-managed class needs `@inject(TOKEN)`.
 * Decorator metadata is not emitted, and tsyringe silently passes `undefined` when a trailing
 * parameter has no token, so this is enforced statically.
 */
// Note: esquery does not support the child form `:has(> ...)`; it silently matches nothing.
const DI_CLASS =
  'ClassDeclaration[decorators.length>0]:has(Decorator > CallExpression[callee.name=/^(injectable|singleton|scoped)$/])';
const UNDECORATED_CTOR_PARAM = `${DI_CLASS} MethodDefinition[kind="constructor"] > FunctionExpression > :matches(Identifier, TSParameterProperty, AssignmentPattern)[decorators.length=0]`;
const INJECT_TOKEN_RULES = [
  {
    selector: UNDECORATED_CTOR_PARAM,
    message:
      'Constructor parameters of @injectable/@singleton/@scoped classes must use @inject(TOKEN) (see ADR-0001).',
  },
];

export default tseslint.config(
  {
    // Architecture fixtures contain deliberately broken imports and are not in tsconfig.
    ignores: ['dist/', 'coverage/', 'node_modules/', 'tests/fixtures/architecture/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': ['error', ...INJECT_TOKEN_RULES],

      // Type-aware rules for asynchronous code: an un-awaited promise loses its errors and
      // breaks transaction and correlation scoping.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // Express 5 handles promises returned by handlers, so async route handlers are allowed.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false } },
      ],
    },
  },
  {
    // Plain JS config files are outside the TypeScript project.
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
