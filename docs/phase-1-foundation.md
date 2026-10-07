# Phase 1 — Foundation

## Goal

Establish the complete technical foundation before implementing business modules.

## Scope

- Initialize TypeScript project
- Express HTTP server
- PostgreSQL connection
- Redis connection
- `tsyringe` dependency injection
- Configuration management
- Structured logging
- Correlation ID
- Global error handling
- Request validation foundation
- Pagination foundation
- Transaction abstraction
- Application bootstrap
- Worker bootstrap
- Health/readiness endpoints
- Basic testing setup

## Explicit Constraints

- No business features.
- No Auth implementation yet.
- No ORM.
- SQL only.
- `pkg/` must remain independent.
- Do not introduce unnecessary abstractions.
- Every infrastructure dependency is injected.
- Controllers must remain thin.

## Expected Structure

```text
src/
├── app/
├── lib/
├── pkg/
├── migrations/
├── app.ts
├── server.ts
└── worker.ts
```

## Acceptance Criteria

- Application starts successfully.
- PostgreSQL connection works.
- Redis connection works.
- DI container resolves dependencies.
- Correlation ID is created/preserved.
- Global error handler returns consistent errors.
- Pagination primitives exist.
- Transaction abstraction exists.
- Health endpoint works.
- Readiness endpoint checks required dependencies.
- Worker can bootstrap independently.
- Tests run successfully.
- No ORM exists in dependencies or code.

## Deliverables

- Project initialization
- Configuration module
- Logger
- HTTP bootstrap
- DI container
- Database infrastructure
- Redis infrastructure
- Error infrastructure
- Correlation middleware
- Validation foundation
- Pagination foundation
- Transaction abstraction
- Health/readiness endpoints
- Test foundation

## AI Task Rule

Implement this phase through small tasks. Do not generate the whole phase in one response or one code-generation request.

Recommended order:

1. Project initialization
2. TypeScript configuration
3. Configuration system
4. Logger
5. HTTP bootstrap
6. DI container
7. PostgreSQL infrastructure
8. Redis infrastructure
9. Correlation ID
10. Global error handling
11. Validation
12. Pagination
13. Transaction abstraction
14. Health/readiness
15. Worker bootstrap
16. Tests
17. Foundation review
