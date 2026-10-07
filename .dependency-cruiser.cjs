// Architecture rules (blueprint §5, §6, §7, §13, ADR-0001). `pnpm depcruise` enforces them, and
// tests/unit/architecture/dependency-rules.test.ts proves each rule fires on fixture violations.
//
// Paths are matched with `(^|/)src/` rather than `^src/` so the same rules apply to the fixtures.

const ORM_PACKAGES =
  '(typeorm|@prisma/client|prisma|sequelize|sequelize-typescript|@mikro-orm/[^/]+|drizzle-orm|knex|objection|bookshelf|waterline|mongoose)';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-orm',
      severity: 'error',
      comment: 'No ORM or query builder: SQL lives in repositories (blueprint §7).',
      from: {},
      to: { path: `(^|/)node_modules/${ORM_PACKAGES}/` },
    },
    {
      name: 'pkg-is-independent',
      severity: 'error',
      comment:
        'pkg/ is an independent library layer: it must not import app, lib or entrypoints (blueprint §6).',
      from: { path: '(^|/)src/pkg/' },
      to: { path: '(^|/)src/', pathNot: '(^|/)src/pkg/' },
    },
    {
      name: 'lib-does-not-import-app',
      severity: 'error',
      comment: 'lib/ is cross-cutting infrastructure used by modules; it must not depend on them.',
      from: { path: '(^|/)src/lib/' },
      to: { path: '(^|/)src/app/' },
    },
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment:
        'Domain code depends on nothing outward: no application/infrastructure/presentation layers, no infrastructure libraries (blueprint §5).',
      from: { path: '(^|/)src/app/[^/]+/domain/' },
      to: {
        path: [
          '(^|/)src/app/[^/]+/(application|infrastructure|presentation)/',
          '(^|/)src/lib/(database|cache|events|transaction|http|health|lifecycle|dependency-injection|audit|correlation|validation)/',
          '(^|/)node_modules/(express|pg|ioredis|amqplib|tsyringe|pino)/',
        ],
      },
    },
    {
      name: 'application-uses-ports',
      severity: 'error',
      comment:
        'Application services depend on ports, not on infrastructure or presentation (blueprint §5, §13).',
      from: { path: '(^|/)src/app/[^/]+/application/' },
      to: {
        path: [
          '(^|/)src/app/[^/]+/(infrastructure|presentation)/',
          '(^|/)node_modules/(express|pg|ioredis|amqplib)/',
        ],
      },
    },
    {
      name: 'app-module-boundaries',
      severity: 'error',
      comment: "A module may use another module only through that module's index.ts.",
      from: { path: '(^|/)src/app/([^/]+)/' },
      to: {
        path: '(^|/)src/app/([^/]+)/',
        pathNot: ['(^|/)src/app/$2/', '(^|/)src/app/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make initialization order fragile and layering meaningless.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-dev-dependencies-in-src',
      severity: 'error',
      comment:
        'Production code must not import devDependencies (they are absent in production installs).',
      from: { path: '(^|/)src/' },
      to: { dependencyTypes: ['npm-dev'] },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      comment: 'Every import must resolve (catches typos and missing dependencies).',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.js', '.json'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      exportsFields: ['exports'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
