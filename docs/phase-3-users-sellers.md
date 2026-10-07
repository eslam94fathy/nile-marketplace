# Phase 3 — Users & Sellers

## Goal

Build the marketplace user/profile and seller domain on top of the completed Foundation and Authentication phases.

This phase introduces the Seller business lifecycle, including mandatory Admin approval.

The key business rule is:

> A seller may register, but cannot sell until an Admin approves the seller.

---

# 1. Scope

This phase contains:

- User profile
- Seller profile
- Seller registration/application
- Seller approval workflow
- Seller rejection workflow
- Seller activation/deactivation foundation
- Admin authorization required for seller approval
- Seller ownership foundation for future Products
- Audit trail for seller decisions
- Domain/application rules around seller status

This phase does NOT implement Products, Inventory, Cart, Orders, Payments, or Delivery.

---

# 2. Actors

## Customer/User

A normal authenticated user can maintain their own profile.

## Seller

A seller is an authenticated user with seller-specific information.

A seller starts in:

```text
PENDING_APPROVAL
```

## Admin

Only an authorized Admin can:

- Review sellers
- Approve sellers
- Reject sellers
- Activate/deactivate sellers where permitted

Authorization must be enforced at the application boundary, not only in controllers.

---

# 3. Seller Lifecycle

The primary lifecycle is:

```text
REGISTER
   ↓
PENDING_APPROVAL
   ↓
ADMIN REVIEW
   ├── APPROVED
   │      ↓
   │    ACTIVE
   │
   └── REJECTED
```

If the design allows re-submission after rejection:

```text
REJECTED
   ↓
RESUBMITTED
   ↓
PENDING_APPROVAL
```

The exact re-submission policy must be decided before implementation.

---

# 4. Critical Business Rule

Seller approval is mandatory.

A seller cannot:

- Publish products
- Make products sellable
- Participate in marketplace selling operations

unless the seller is approved and active.

Future Product operations must be able to rely on a reusable rule such as:

```text
SellerCanSell
```

Do not duplicate:

```text
seller.status === ...
```

throughout future modules.

---

# 5. User vs Seller

Do not create a completely separate authentication identity for sellers.

The intended relationship is:

```text
User
  │
  └── Seller Profile
```

Conceptually:

```text
users
  ↓
seller_profiles
```

A user may have a seller profile.

Authentication remains centralized in Phase 2.

Seller business information belongs to the seller domain.

---

# 6. Suggested Seller Information

The exact fields must be finalized during the design task.

Potential information:

```text
seller id
user id
display/business name
legal/business information if required
contact information
status
created_at
updated_at
approved_at
approved_by
rejected_at
rejected_by
rejection_reason
```

Do not add regulatory/KYC fields unless they are actually required by the marketplace requirements.

Avoid speculative columns.

---

# 7. Status Model

Recommended initial status:

```text
PENDING_APPROVAL
APPROVED
REJECTED
SUSPENDED
```

The exact distinction between `APPROVED` and `ACTIVE` must be finalized.

If both are used:

```text
APPROVED
   ↓
ACTIVE
```

Then:

- `APPROVED` means the admin approved the seller.
- `ACTIVE` means the seller is currently allowed to operate.

This distinction is useful for future suspension/deactivation.

Do not introduce both states unless the implementation has a real need for both.

---

# 8. Admin Authorization

Authentication tells us:

```text
Who is the user?
```

Authorization tells us:

```text
Is this user an Admin?
```

Seller approval must require an Admin capability/role.

Example:

```text
Authenticated User
        ↓
Authorization
        ↓
Admin?
   ┌────┴────┐
  YES       NO
   ↓         ↓
Approve    Forbidden
```

Do not rely on frontend restrictions.

The backend must enforce authorization.

---

# 9. Authorization Design

Keep authorization extensible.

Avoid scattering hard-coded checks such as:

```text
if user.role === "admin"
```

through business logic.

Prefer a reusable authorization abstraction/policy.

Conceptually:

```text
Authorization Policy
        ↓
CanApproveSeller
```

The exact RBAC/permission model will be finalized during the design task.

---

# 10. Seller APIs

Initial APIs:

```text
POST /sellers
GET  /sellers/me
PATCH /sellers/me
```

Admin APIs:

```text
GET  /admin/sellers
GET  /admin/sellers/:id
POST /admin/sellers/:id/approve
POST /admin/sellers/:id/reject
```

Exact URL versioning and naming must follow the global API conventions established in Foundation.

Do not implement unrelated Admin modules.

---

# 11. Seller Registration

Flow:

```text
Authenticated User
       ↓
Create Seller Profile
       ↓
PENDING_APPROVAL
```

Rules:

- User must be authenticated.
- A user cannot create duplicate seller profiles unless explicitly supported.
- Seller starts pending.
- Seller cannot sell immediately.
- Seller profile creation must be auditable where appropriate.

---

# 12. Seller Approval

Flow:

```text
Admin
  ↓
Approve Seller
  ↓
Validate Seller State
  ↓
Change Status
  ↓
Audit
  ↓
Outbox Event if required
```

Possible event:

```text
SellerApproved
```

Do not publish an event before the database transaction is committed.

Use the existing Outbox pattern.

---

# 13. Seller Rejection

Flow:

```text
Admin
  ↓
Reject Seller
  ↓
Validate Seller State
  ↓
Require/record reason if policy requires
  ↓
Change Status
  ↓
Audit
```

Possible event:

```text
SellerRejected
```

The rejection reason must not expose internal/system details.

---

# 14. State Transition Rules

Transitions must be explicit.

Example:

```text
PENDING_APPROVAL → APPROVED
PENDING_APPROVAL → REJECTED
```

Invalid examples:

```text
APPROVED → APPROVED
REJECTED → APPROVED
```

unless a re-review/re-submission policy explicitly allows them.

The domain should own transition rules.

Do not let controllers directly manipulate status fields.

---

# 15. Repository Strategy

Continue the project's SQL-only repository approach.

Potential ports:

```text
UserRepository
SellerRepository
```

Infrastructure implementations use SQL.

No ORM.

No generic query abstraction unless there is a concrete repeated need.

---

# 16. Transactions

Seller approval is a transactional business operation if it changes multiple persistent resources.

Potential flow:

```text
BEGIN
  update seller status
  create audit record
  create outbox event
COMMIT
```

If only one resource is persisted and audit/outbox are handled differently, keep the transaction appropriately scoped.

Do not create unnecessarily broad transactions.

---

# 17. Audit

Mandatory audit targets:

```text
SellerCreated
SellerApproved
SellerRejected
SellerSuspended
SellerReactivated
```

Where applicable include:

```text
actor_id
seller_id
action
previous_status
new_status
reason
metadata
correlation_id
timestamp
```

Never store credentials or sensitive authentication tokens.

---

# 18. Outbox

Use Outbox only for events that have a real integration/consumer purpose.

Potential events:

```text
SellerApproved
SellerRejected
```

Future consumers may include:

- Notifications
- Search/indexing
- Analytics
- Seller onboarding

The event payload must contain stable identifiers and useful metadata without leaking sensitive data.

---

# 19. User Profile

Implement only the user-profile functionality needed by the marketplace.

Potential APIs:

```text
GET   /users/me
PATCH /users/me
```

Do not allow a user to update privileged fields such as:

- role
- seller status
- admin status
- account permissions

These are controlled by dedicated business flows.

---

# 20. Admin Bootstrap

The project needs a safe way to create the initial Admin.

Do not hard-code an Admin into application code.

The implementation task must decide on one secure mechanism, such as:

- controlled seed
- migration/bootstrap command
- environment-controlled initialization

Do not expose a public API that lets arbitrary users become Admins.

---

# 21. Security Rules

Mandatory:

- Only authenticated users can create/manage their seller profile.
- Only authorized Admins can approve/reject sellers.
- Users cannot modify seller status directly.
- Users cannot modify roles/permissions through profile APIs.
- Seller status changes are audited.
- Admin authorization is enforced server-side.
- Do not leak sensitive seller information to unauthorized users.
- Do not expose internal rejection metadata unnecessarily.

---

# 22. Testing Requirements

## Unit tests

Test:

- Seller creation rules
- Seller state transitions
- Approval rules
- Rejection rules
- Authorization policies
- Duplicate seller prevention
- SellerCanSell rule

## Integration tests

Test:

- Create seller
- Get own seller profile
- Update own seller profile
- Admin seller listing
- Admin seller details
- Approve seller
- Reject seller
- Unauthorized approval attempt
- Invalid state transition

## Security tests

Verify:

- Non-admin cannot approve
- Non-admin cannot reject
- User cannot modify seller status
- User cannot modify role
- Seller cannot sell while pending/rejected
- Admin actions are auditable

---

# 23. Acceptance Criteria

Phase 3 is complete only when:

- User profile functionality works.
- Seller profile can be created.
- New sellers start pending.
- Admin authorization works.
- Admin can approve sellers.
- Admin can reject sellers.
- Invalid seller state transitions are blocked.
- Seller status cannot be modified directly by users.
- `SellerCanSell` is available as a reusable domain/business rule.
- Seller ownership is ready for the Product phase.
- Audit records exist for critical seller decisions.
- Outbox is used where a real event consumer exists.
- SQL repositories follow project rules.
- No ORM is introduced.
- DI is used consistently.
- Tests cover success, failure, authorization, and state transitions.

---

# 24. AI Task Breakdown

Do not implement the whole phase in one AI request.

## Task 3.1 — Seller Domain Design

Finalize:

- Seller/user relationship
- Seller fields
- Status model
- APPROVED vs ACTIVE decision
- Rejection policy
- Re-submission policy
- Admin role/permission model
- SellerCanSell rule

Produce an ADR before coding.

## Task 3.2 — User Profile

Implement:

- User profile query/update
- Validation
- Authorization
- SQL repository methods
- Tests

## Task 3.3 — Seller Persistence

Implement:

- Seller domain model
- Seller repository port
- SQL repository
- Migration
- Constraints/indexes
- Tests

## Task 3.4 — Seller Registration

Implement:

```text
POST /sellers
```

with application service, validation, persistence, authorization, and tests.

## Task 3.5 — Seller Profile

Implement:

```text
GET /sellers/me
PATCH /sellers/me
```

## Task 3.6 — Authorization Foundation

Implement the reusable Admin authorization/policy required for this phase.

## Task 3.7 — Admin Seller Listing

Implement:

```text
GET /admin/sellers
GET /admin/sellers/:id
```

with global pagination.

## Task 3.8 — Seller Approval

Implement:

```text
POST /admin/sellers/:id/approve
```

including transaction, audit, and Outbox where applicable.

## Task 3.9 — Seller Rejection

Implement:

```text
POST /admin/sellers/:id/reject
```

including reason policy, audit, and Outbox where applicable.

## Task 3.10 — SellerCanSell

Create the reusable business rule that future Product operations will depend on.

## Task 3.11 — Security and Edge Cases

Review:

- Authorization
- State transitions
- Duplicate sellers
- Race conditions
- Idempotency
- Audit
- Information leakage

## Task 3.12 — Phase Review

Run:

- Unit tests
- Integration tests
- Security tests
- Architecture/dependency review
- SQL/database review

Do not start Phase 4 until this review passes.

---

# 25. Out of Scope

Do not implement in Phase 3:

- Products
- Product variants
- Inventory
- Cart
- Orders
- Payments
- Delivery
- Seller payouts
- Seller commissions
- Seller analytics
- Seller dashboard beyond required profile/admin operations
- KYC integrations
- External seller verification
- Advanced RBAC/ABAC unless required for the Admin authorization foundation
