# ADR-0001 — Foundation Stack and Cross-Cutting Conventions

- **Status:** Accepted
- **Date:** 2026-10-07
- **Phase:** 1 — Foundation

## Context

The blueprint (`docs/marketplace_blueprint.md`) fixes the architecture: no ORM, SQL repositories, `tsyringe` DI, PostgreSQL as the system of record, Redis for infrastructure only, Outbox, audit and correlation IDs. It leaves the concrete tooling open. This ADR fixes the tooling and the conventions every phase must follow, so later AI tasks don't re-decide them.

## Decisions

### Runtime and tooling

| Concern              | Decision                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Runtime              | Node.js ≥ 22.12 (LTS line), ESM (`"type": "module"`)                                                                          |
| Package manager      | pnpm (version pinned in `packageManager`). Dependency build scripts are allow-listed in `pnpm-workspace.yaml` (`allowBuilds`) |
| Language             | TypeScript `~6.0`, `strict`                                                                                                   |
| Dev runner           | `tsx` (watch mode); production runs compiled `dist/` with plain `node`                                                        |
| Lint / format        | ESLint (flat config) + `typescript-eslint` + Prettier (`eslint-config-prettier` disables conflicting rules)                   |
| Tests                | Vitest + Supertest; integration tests use the Docker Compose services and a separate `nile_test` database                     |
| Architecture checks  | `dependency-cruiser` (rules added in Task 1.18)                                                                               |
| Local infrastructure | `docker-compose.yml`: PostgreSQL 18, Redis 8, RabbitMQ 4 (management)                                                         |

**Why TypeScript 6.0, not 7.** TypeScript 7 is the native (Go) compiler. It doesn't provide the JS compiler API that `typescript-eslint` (peer range `<6.1.0`) and `dependency-cruiser` need. TS 7 does still support the legacy decorators `tsyringe` needs. Revisit once the tooling supports TS 7.

### Runtime libraries (added in the tasks that first need them)

| Concern        | Library                                                                           |
| -------------- | --------------------------------------------------------------------------------- |
| HTTP           | Express 5 (async errors propagate to the error middleware natively)               |
| PostgreSQL     | `pg` (Pool) — **no ORM, no query builder**                                        |
| Migrations     | `node-pg-migrate`, plain `.sql` migrations in `src/migrations/`                   |
| Redis          | `ioredis`                                                                         |
| Message broker | RabbitMQ via `amqplib`; adapter in `pkg/messaging`, used only by the Outbox relay |
| Validation     | `zod` (HTTP boundary and env config)                                              |
| Logging        | `pino` (`pino-pretty` in development only)                                        |
| DI             | `tsyringe` + `reflect-metadata`                                                   |

### Conventions

- **Explicit injection tokens.** Every constructor parameter of an injectable uses `@inject(TOKEN)`. We never rely on `emitDecoratorMetadata`, which `tsx`, esbuild and Vitest don't emit. An ESLint rule (`no-restricted-syntax` in `eslint.config.js`) enforces this, because tsyringe silently injects `undefined` when a trailing parameter has no token.
- **Single composition root.** `src/lib/dependency-injection/container.ts`. Modules expose a `registerXModule(container)` function.
- **Identifiers.** `uuid` primary keys defaulting to PostgreSQL 18's `uuidv7()` (time-ordered, which suits keyset pagination and index locality).
- **Time.** `timestamptz` everywhere.
- **Money.** `bigint` minor units + `char(3)` currency code. Never JavaScript floats. To be confirmed in the Phase 4 ADR.
- **API prefix.** Business routes live under `/api/v1`. Health endpoints are unversioned under `/health/*`.
- **Error response:**
  ```json
  { "error": { "code": "…", "message": "…", "details": {}, "correlationId": "…" } }
  ```
- **Error classification.** Every deliberate error extends `AppError` (`src/lib/error`) and has a transport-independent `category` (`VALIDATION`, `NOT_FOUND`, `CONFLICT`, `BUSINESS_RULE`, …) plus a stable `code`. Only the HTTP error handler maps categories to status codes, so domain code never depends on HTTP. Messages of `INTERNAL` errors are never returned to clients. Repositories translate known constraint violations into domain errors; untranslated unique/FK violations fall back to a generic 409 and are logged as warnings.
- **List response:**
  ```json
  { "data": [], "pagination": { "nextCursor": "…", "hasNextPage": true } }
  ```
  `limit` defaults to 20, max 100. Cursors are opaque (base64url).
- **Module layout** (`src/app/<module>/`): `domain/`, `application/` (services + ports), `infrastructure/` (SQL repositories with co-located SQL), `presentation/` (controllers, zod schemas, router), `index.ts`.
- **Outbox and audit** infrastructure is part of Phase 1 (tasks 1.15–1.16) so later phases can use it. Business events are only added when a real consumer exists.

## Consequences

- Every later phase reuses the Phase 1 primitives (`Database`, `TransactionManager`, `OutboxWriter`, `AuditLogger`, validation, pagination, `AppError`) instead of redefining them.
- Upgrading to TypeScript 7 is a deliberate future change, gated on lint and architecture tooling support.
- Changing any decision here requires a new ADR that supersedes this one.
