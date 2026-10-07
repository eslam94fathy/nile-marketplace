# Nile Marketplace — guide for AI-assisted work

Modular e-commerce marketplace backend: TypeScript (ESM, strict), Express 5, PostgreSQL 18 (no ORM), Redis, RabbitMQ, tsyringe.

**Read before changing anything:** `docs/marketplace_blueprint.md` (the rules), the current phase doc `docs/phase-N-*.md`, and `docs/adr/0001-foundation-stack.md` (stack and conventions). Do not silently introduce decisions that contradict them; propose an ADR instead.

## Working rules

- One small task per request, as listed in the phase doc. Never build a whole phase at once.
- Each phase starts with its design/ADR task; do not guess decisions the phase doc says must be finalized first.
- Per task, state: goal, scope, files allowed to change, files that must not change, constraints, acceptance criteria, tests.
- Finish every task with `pnpm check` green, then one commit on the phase branch (e.g. `phase-1/foundation`).

## Commands

```bash
docker compose up -d --wait   # PostgreSQL, Redis, RabbitMQ (required for integration tests)
pnpm check                    # lint + typecheck + format:check + build + all tests (what CI runs)
pnpm test:unit | pnpm test:int
pnpm dev | pnpm worker:dev    # API on :3000, worker health on :3001 (reads .env; copy .env.example)
pnpm migrate:create <name>    # new .sql migration in src/migrations; pnpm migrate:up / migrate:down
pnpm depcruise                # architecture report (CLI needs Node 22/24; the rules also run in pnpm test)
```

## Structure and dependency rules (enforced by `.dependency-cruiser.cjs` + tests)

```
src/app/<module>/{domain,application,infrastructure,presentation}/ + index.ts
src/lib/   cross-cutting infrastructure (never imports app/)
src/pkg/   independent library code (imports nothing from app/ or lib/)
src/migrations/  plain SQL (node-pg-migrate)
```

- domain → nothing outward (no application/infrastructure/presentation, no express/pg/ioredis/tsyringe).
- application → ports only (no infrastructure/presentation, no drivers).
- Modules use each other only through `app/<module>/index.ts`. No cycles. No ORM / query builder.

## Conventions (use the existing primitives; do not re-create them)

| Need         | Use                                                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DI           | `TOKENS` + composition root `lib/dependency-injection/container.ts`. **Every** constructor param: `@inject(TOKEN)` (lint-enforced; no decorator metadata).                                      |
| SQL          | `Database.query(sql, params)` with `$1` params; SQL lives in the repository. Translate known constraint violations with `violatesConstraint()`.                                                 |
| Transactions | `TransactionManager.run(fn)`; repositories need no tx parameter (AsyncLocalStorage).                                                                                                            |
| Errors       | Subclass `NotFoundError`, `ConflictError`, `BusinessRuleError`, … from `lib/error/errors.ts` with a specific `code`. Controllers never catch. Category → HTTP status only in the error handler. |
| Validation   | `validate({ params, query, body })` + `validated(res, schemas)` (zod). Unknown keys are stripped.                                                                                               |
| Lists        | `paginationQuerySchema`, `buildPage` (fetch `limit + 1`), `createCursorCodec`. Chronological order = uuidv7 `id`.                                                                               |
| Events       | `OutboxWriter.append()` inside the business transaction; only for events with a real consumer.                                                                                                  |
| Audit        | `AuditLogger.record()`; success inside the transaction, failures outside it. No secrets in metadata.                                                                                            |
| Logging      | Injected pino `Logger`; correlation ID is added automatically.                                                                                                                                  |
| Money        | `bigint` minor units + currency (confirm in the Phase 4 ADR). Never JS floats.                                                                                                                  |

## Gotchas learned in Phase 1 (each is covered by a test)

- tsyringe silently injects `undefined` for a trailing param without `@inject`.
- `pool.query()` destroys the connection after a failed query: session state (TEMP tables, `SET`) does not survive. Transactions hold one client.
- PostgreSQL answers `COMMIT` with `ROLLBACK` (no error) if a statement inside failed and was caught; `TransactionManager` turns that into an error.
- Promises not awaited inside `TransactionManager.run()` must not touch the database after it ends (guarded).
- Checked-out pg clients, ioredis and amqplib emit `error` events; unhandled ones crash the process. Always attach a listener.
- Cursor keys from timestamps must not go through JS `Date` (ms vs µs precision loses rows); use `TIMESTAMP_CURSOR_KEY_SQL`.
- `pg` sends a JS array as a PostgreSQL array: always `JSON.stringify()` jsonb values.
- Use an explicit cast when one SQL parameter is used in two type contexts (`$2::int`).
- Outbox delivery is at-least-once and best-effort ordered: consumers deduplicate by message ID.
- Express 5 `req.query` is read-only; use `validated()`.

## Tests

- `tests/unit` (no infrastructure) and `tests/integration` (real services; files run sequentially; global setup migrates `nile_test`).
- Helpers in `tests/support` and `tests/integration/support`: `createTestApp`, `createTestContainer`, `captureLogger`, `createTestPool`, `captureMessages`.
- Clean up the tables a test uses (`TRUNCATE`); never depend on test order.
