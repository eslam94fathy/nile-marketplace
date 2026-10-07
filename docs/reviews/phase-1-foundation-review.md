# Phase 1 — Foundation review

- **Date:** 2026-10-07
- **Branch:** `phase-1/foundation`
- **Result:** Passed. Phase 2 may start.

## Quality gate

| Check                                                                       | Result                                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm check` (lint incl. type-aware rules, typecheck, format, build, tests) | Pass: 29 files, 329 tests (unit + integration against PostgreSQL 18.6, Redis 8, RabbitMQ 4) |
| Architecture rules (`pnpm depcruise`, Node 24)                              | No violations (51 modules, 139 dependencies); every rule proven against fixtures            |
| Full suite on Node 22.23, 24.21 and 25.0                                    | Pass                                                                                        |
| Migrations up / down / up on the dev database                               | Pass (`outbox_events`, `audit_logs`)                                                        |

## Acceptance criteria (`docs/phase-1-foundation.md`)

| Criterion                                      | Evidence                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Application starts successfully                | Built `dist/server.js` and `dist/worker.js`, and `tsx` dev entrypoints, start and serve requests                                     |
| PostgreSQL connection works                    | `tests/integration/lib/database/*`; `/health/ready` reports `postgres: up`                                                           |
| Redis connection works                         | `tests/integration/lib/cache/redis.test.ts`; readiness `redis: up`; real container stop → 503, restart → automatic reconnect → 200   |
| DI container resolves dependencies             | `tests/unit/lib/dependency-injection/container.test.ts` (every token, API and worker); explicit `@inject` enforced by ESLint         |
| Correlation ID is created/preserved            | `tests/unit/lib/correlation/*`; echoed in responses and errors, present in log lines, outbox rows, audit rows and published messages |
| Global error handler returns consistent errors | `tests/unit/lib/error/*`: standard shape, masked internals, body-parser and database fallbacks                                       |
| Pagination primitives exist                    | `src/lib/pagination`; keyset correctness proven against PostgreSQL (`tests/integration/lib/pagination`)                              |
| Transaction abstraction exists                 | `TransactionManager`; `tests/integration/lib/transaction` (commit, rollback, nesting, isolation, broken connections, escaped work)   |
| Health endpoint works                          | `GET /health/live` (API and worker)                                                                                                  |
| Readiness checks required dependencies         | API: PostgreSQL + Redis; worker: PostgreSQL + RabbitMQ (`tests/integration/app/health.test.ts`, `tests/integration/worker.test.ts`)  |
| Worker can bootstrap independently             | `startWorker()` / `dist/worker.js`; relays real events, drains backlogs, survives broker outages, shuts down gracefully              |
| Tests run successfully                         | See quality gate                                                                                                                     |
| No ORM in dependencies or code                 | `no-orm` architecture rule + manifest test                                                                                           |

Constraints also verified: no business or authentication code (only the `health` module exists), SQL only, `pkg/` independent, infrastructure constructed only in providers and the composition root, only `loadConfig()` reads `process.env`.

## Fixed during the review

- Client-error (4xx) debug logs no longer include stack traces.
- ADR-0001 brought up to date (Node 24 for CI, quality gate, worker health, outbox delivery guarantees, audit rules).

## Carried forward

| Item                                                                                | When                                                 |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `trust proxy` setting (client IPs behind a load balancer)                           | Phase 2, before login rate limiting                  |
| Rate limiting and idempotency (Redis), first `pkg/cache` need                       | Phase 2 / Phase 6                                    |
| Per-request access log                                                              | Decide when observability is designed (Phase 10)     |
| Readiness → 503 during graceful shutdown (load-balancer draining)                   | Phase 10                                             |
| Re-drive / alerting for outbox events that exhausted their attempts                 | Phase 10                                             |
| Durable consumer queues (messages to `nile.events` with no bound queue are dropped) | With the first real event consumer                   |
| Automatic retry of serialization failures                                           | Per operation that needs it (e.g. checkout, Phase 6) |
| CI workflow has not run yet (action versions unverified)                            | First push of the branch                             |
| Phase 7–10 docs do not exist yet                                                    | Before each of those phases                          |
