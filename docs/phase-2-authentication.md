# Phase 2 — Authentication

## Goal

Build the authentication subsystem on top of the completed Foundation phase.

Authentication must be secure, modular, testable, and independent from the HTTP framework as much as practical.

## Scope

### 1. Identity

Support the initial customer/user identity lifecycle:

- Register
- Login
- Logout/session invalidation where applicable
- Refresh access token
- Get current authenticated user

The identity model should be extensible later for:

- Customer
- Seller
- Admin
- Delivery Agent

Do not duplicate authentication logic per actor.

---

## 2. Password Authentication

Use password-based authentication for the MVP.

Required capabilities:

- Password hashing
- Password verification
- Password strength validation
- Never store plaintext passwords
- Never log passwords
- Never return password hashes through API responses

Password hashing must be behind an application/security port so the application layer does not depend directly on a hashing library.

Example direction:

```text
Application
    ↓
PasswordHasherPort
    ↑
PasswordHasherAdapter
```

---

## 3. Access and Refresh Tokens

Use a short-lived access token and a longer-lived refresh mechanism.

Conceptually:

```text
Login
  ↓
Verify Credentials
  ↓
Access Token
+
Refresh Token
```

Access token:

- Short lifetime
- Used for authenticated API requests

Refresh token:

- Longer lifetime
- Used to obtain a new access token
- Must support revocation/invalidation

Do not put sensitive information into JWT payloads.

The exact algorithm, expiry values, cookie/header strategy, and token storage mechanism must be decided in the implementation task before coding rather than guessed by the AI.

---

## 4. Token Security

The design must support:

- Token rotation where appropriate
- Refresh-token invalidation
- Logout invalidation
- Protection against token replay
- Secure secret/key management through configuration
- No secrets committed to source control

If refresh tokens are persisted, store a secure representation rather than relying on plaintext token storage.

Redis may be used for short-lived/revocation-related data, but PostgreSQL remains the source of truth for persistent identity data.

---

## 5. Authentication vs Authorization

Keep authentication and authorization separate.

### Authentication

Answers:

```text
Who is this user?
```

### Authorization

Answers:

```text
Is this user allowed to perform this action?
```

Authorization will become more important when Seller/Admin/Delivery Agent capabilities are introduced.

The authentication subsystem should expose the authenticated principal without hardcoding marketplace business rules.

---

## 6. Application Structure

Follow the project architecture:

```text
Controller
    ↓
Application Service
    ↓
Domain / Ports
    ↓
Infrastructure
```

Potential module structure:

```text
src/app/auth/
├── domain/
├── application/
├── infrastructure/
├── presentation/
└── index.ts
```

The exact structure must remain consistent with the Foundation conventions established in Phase 1.

---

## 7. Authentication Ports

The application should depend on ports/interfaces for infrastructure concerns.

Potential ports:

```text
PasswordHasher
TokenService
RefreshTokenStore
AuthenticationRepository
```

Do not allow the application service to directly instantiate:

```text
bcrypt
argon2
jsonwebtoken
Redis client
PostgreSQL client
```

Use dependency injection.

---

## 8. Database

Create only the identity/authentication tables needed by this phase.

At minimum, model:

```text
users
```

Potential authentication-related persistence may include refresh-token/session data depending on the final token strategy.

Important constraints:

- Unique email/username according to the final identity decision
- Appropriate indexes
- Timestamps
- Soft-delete/status strategy only if justified by the project design
- No unnecessary columns

Do not prematurely create seller, product, order, or delivery tables.

---

## 9. User Lifecycle

Initial user lifecycle:

```text
REGISTER
   ↓
ACTIVE
```

If account-management states are introduced, they must be explicitly defined and consistently enforced.

Authentication must reject users who are not allowed to authenticate.

---

## 10. API Endpoints

Initial endpoints should be limited to the authentication requirements:

```text
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
```

Exact routing/versioning must follow the global API conventions from Foundation.

Do not add:

- Seller endpoints
- Product endpoints
- Order endpoints
- Admin endpoints

in this phase.

---

## 11. Validation

Validate at the HTTP boundary.

Examples:

### Register

- Required identity fields
- Valid email format if email is the chosen identifier
- Password policy
- Duplicate identity detection

### Login

- Required credentials
- Safe authentication failure response

### Refresh

- Required refresh credential
- Valid token/session
- Revocation checks

Never expose whether an account exists through overly detailed authentication errors when doing so would create user-enumeration risk.

---

## 12. Error Handling

Use the global error system from Phase 1.

Potential errors:

```text
InvalidCredentials
UserAlreadyExists
UserNotFound
InvalidRefreshToken
RefreshTokenRevoked
UserNotActive
```

Do not expose internal implementation details.

Authentication failures should return a consistent public error response.

---

## 13. Security Rules

Mandatory:

- No plaintext passwords
- No plaintext refresh tokens if persisted
- No credentials in logs
- No secrets in source control
- Constant-time/safe password verification through the chosen password hashing implementation
- Rate limiting should be considered for login and refresh endpoints
- Avoid user enumeration
- Validate all external input
- Do not trust token claims without signature verification
- Keep access tokens short-lived
- Revoke/rotate refresh credentials appropriately

---

## 14. Transactions

Registration should use a transaction where multiple persistent changes are required.

Example:

```text
BEGIN
  create user
  create required identity/auth data
COMMIT
```

If only one atomic user row is required, do not introduce unnecessary transactional complexity.

Login normally does not require a long database transaction.

---

## 15. Redis Usage

Redis may support:

- Refresh-token/session revocation
- Login rate limiting
- Temporary security state

Do not move the primary user record to Redis.

---

## 16. Events / Outbox

Do not create events merely for the sake of using the Outbox pattern.

If registration produces a meaningful domain/integration event, it may be emitted through the existing Outbox infrastructure.

Possible event:

```text
UserRegistered
```

Only introduce it when there is a real consumer/use case.

---

## 17. Audit

Audit security-sensitive actions where appropriate:

```text
UserRegistered
UserLoggedIn
UserLoggedOut
RefreshTokenRotated
AuthenticationFailure
```

Do not store passwords or raw tokens in audit metadata.

---

## 18. Testing Requirements

### Unit tests

Cover:

- Password hashing/verification abstraction
- Registration rules
- Login rules
- Token validation behavior
- Refresh-token rules
- Logout/revocation behavior
- Authentication failure cases

### Integration tests

Cover:

- Register endpoint
- Login endpoint
- Refresh endpoint
- Logout endpoint
- `/auth/me`
- Database persistence
- Redis behavior where used

### Security tests

At minimum verify:

- Password is not persisted as plaintext
- Password hash is never returned
- Invalid credentials fail safely
- Invalid refresh token fails
- Revoked refresh token fails
- Protected endpoint rejects unauthenticated requests

---

## 19. Acceptance Criteria

Phase 2 is complete only when:

- User registration works.
- Passwords are securely hashed.
- Login works.
- Access-token authentication works.
- Refresh-token flow works.
- Logout invalidates the refresh mechanism.
- `/auth/me` returns the authenticated user.
- Authentication middleware is reusable by future modules.
- DI is used for authentication dependencies.
- No ORM exists.
- SQL repositories follow the project SQL rules.
- Global errors are used.
- Correlation ID appears in relevant logs.
- Authentication secrets are configuration-driven.
- Tests cover success and failure paths.
- No business modules outside authentication were introduced.

---

## 20. AI Task Breakdown

Do not implement the whole phase in one AI request.

Recommended tasks:

### Task 2.1 — Authentication Design Decision

Finalize:

- Identity field(s)
- Password hashing algorithm
- Access-token strategy
- Refresh-token strategy
- Token rotation
- Token storage
- Expiry policy
- Cookie/header strategy
- Secret/key configuration
- Authentication error policy

Output should be a short architecture decision record before code.

### Task 2.2 — User Persistence

Implement:

- User domain model
- User repository port
- SQL repository
- Migration
- Tests

### Task 2.3 — Password Security

Implement:

- PasswordHasher port
- PasswordHasher adapter
- Password policy
- Tests

### Task 2.4 — Registration

Implement:

```text
POST /auth/register
```

including validation, application service, persistence, errors, and tests.

### Task 2.5 — Login

Implement:

```text
POST /auth/login
```

including credential verification and token issuance.

### Task 2.6 — Authentication Middleware

Implement:

```text
Authorization: Bearer <access-token>
```

and authenticated request context.

### Task 2.7 — Refresh Tokens

Implement:

```text
POST /auth/refresh
```

with the finalized rotation/revocation strategy.

### Task 2.8 — Logout

Implement:

```text
POST /auth/logout
```

and invalidate the refresh mechanism.

### Task 2.9 — Current User

Implement:

```text
GET /auth/me
```

### Task 2.10 — Security Hardening

Review:

- Rate limiting
- User enumeration
- Token replay
- Secret management
- Logging
- Error responses
- Validation
- Audit

### Task 2.11 — Phase Review

Run:

- Unit tests
- Integration tests
- Security tests
- Architecture/dependency review

Do not start Phase 3 until the review passes.

---

## 21. Out of Scope

Explicitly postponed:

- Seller approval
- Seller authentication-specific behavior
- Admin authorization rules
- Delivery-agent authentication-specific behavior
- Product permissions
- Order permissions
- OAuth/social login
- MFA
- Password reset unless explicitly added as a Phase 2 requirement
- Email verification unless explicitly added as a Phase 2 requirement

These can be added after the core authentication foundation is stable.
