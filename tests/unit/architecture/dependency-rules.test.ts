import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findArchitectureViolations, type Violation } from '../../support/cruise.js';

const FIXTURES = 'tests/fixtures/architecture/src';

const at = (file: string) => `${FIXTURES}/${file}`;

describe('architecture rules (.dependency-cruiser.cjs)', () => {
  it('the production code has no violations', async () => {
    expect(await findArchitectureViolations(['src'])).toEqual([]);
  }, 60_000);

  describe('every rule fires on its fixture violation', () => {
    let violations: Violation[];
    const violationsOf = async (rule: string) => {
      violations ??= await findArchitectureViolations([FIXTURES]);
      return violations
        .filter((v) => v.rule === rule)
        .map((v) => v.from)
        .sort();
    };

    it('pkg-is-independent: pkg/ must not import lib/ or app/', async () => {
      expect(await violationsOf('pkg-is-independent')).toEqual([
        at('pkg/messaging/imports-lib.ts'),
      ]);
    }, 60_000);

    it('lib-does-not-import-app', async () => {
      expect(await violationsOf('lib-does-not-import-app')).toEqual([at('lib/imports-app.ts')]);
    });

    it('domain-is-pure: no outer layers, infrastructure lib or infrastructure packages', async () => {
      expect(await violationsOf('domain-is-pure')).toEqual([
        at('app/catalog/domain/imports-application.ts'),
        at('app/catalog/domain/imports-express.ts'),
        at('app/catalog/domain/imports-lib-database.ts'),
      ]);
    });

    it('application-uses-ports: no infrastructure layer or driver packages', async () => {
      expect(await violationsOf('application-uses-ports')).toEqual([
        at('app/catalog/application/imports-infrastructure.ts'),
        at('app/catalog/application/imports-pg.ts'),
      ]);
    });

    it('app-module-boundaries: other modules only through their index.ts', async () => {
      expect(await violationsOf('app-module-boundaries')).toEqual([
        at('app/order/application/imports-catalog-internals.ts'),
      ]);
    });

    it('no-circular (each cycle is reported once)', async () => {
      const cycles = await violationsOf('no-circular');

      expect(cycles).toHaveLength(1);
      expect(cycles[0]).toMatch(/app\/order\/domain\/cycle-(a|b)\.ts$/);
    });

    it('no-dev-dependencies-in-src', async () => {
      expect(await violationsOf('no-dev-dependencies-in-src')).toEqual([
        at('lib/uses-dev-dependency.ts'),
      ]);
    });

    it('no-unresolvable', async () => {
      expect(await violationsOf('no-unresolvable')).toEqual([at('lib/unresolvable.ts')]);
    });

    it('allows the permitted dependencies', async () => {
      const allowed = [
        'pkg/messaging/ok.ts',
        'app/catalog/application/uses-domain.ts',
        'app/order/application/imports-catalog-index.ts',
      ].map(at);
      await violationsOf('no-orm');

      expect(violations.filter((v) => allowed.includes(v.from))).toEqual([]);
    });
  });

  // An ORM cannot be installed as a fixture, so the manifest is checked directly as well.
  it('declares no ORM or query builder dependency', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });

    expect(declared).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^(typeorm|@prisma\/client|prisma|sequelize|@mikro-orm\/.+|drizzle-orm|knex|objection|mongoose)$/,
        ),
      ]),
    );
  });
});
