# Phase 5 — Inventory

## Goal

Build the inventory domain for product variants.

Inventory is a separate business capability from Catalog.

The core rule is:

> Stock belongs to the Product Variant, not directly to the Product.

This phase prepares the marketplace for Cart and Order operations without implementing Cart, Checkout, or Orders yet.

---

# 1. Scope

This phase contains:

- Variant inventory
- Available quantity
- Reserved quantity
- Stock adjustments
- Inventory status
- Inventory history/audit
- Stock reservation foundation
- Stock release foundation
- Concurrency-safe inventory updates
- Inventory queries
- Seller inventory management
- Admin inventory visibility where required

This phase does NOT implement:

- Cart
- Orders
- Payments
- Delivery
- Checkout

---

# 2. Core Business Model

Conceptually:

```text
Seller
  ↓
Product
  ↓
Variant
  ↓
Inventory
```

Inventory belongs to exactly one Variant.

Example:

```text
Product: iPhone 17

Variant A:
  SKU: IP17-256-BLK
  Inventory:
    available = 20
    reserved = 3

Variant B:
  SKU: IP17-512-BLK
  Inventory:
    available = 10
    reserved = 1
```

Do not create product-level stock.

---

# 3. Inventory Quantities

The initial inventory model should distinguish between:

```text
available_quantity
reserved_quantity
```

Conceptually:

```text
Total Physical Stock
    =
available_quantity
+
reserved_quantity
```

The exact interpretation must be finalized in Task 5.1.

Do not add more stock states unless a real business requirement exists.

---

# 4. Inventory Ownership

Inventory is technically associated with a Variant, and the Variant belongs to a Product, which belongs to a Seller.

Therefore:

```text
Inventory
   ↓
Variant
   ↓
Product
   ↓
Seller
```

Seller inventory operations must verify ownership through this relationship.

A seller cannot modify inventory for another seller's variant.

---

# 5. Inventory Creation

When a Variant is created, inventory behavior must follow the decision made in Task 5.1.

Recommended MVP approach:

```text
Create Variant
     ↓
Create Inventory
     ↓
available = initial quantity
reserved = 0
```

If inventory is intentionally created separately, the variant remains non-sellable until inventory exists.

The implementation must use one consistent rule.

---

# 6. Stock Adjustment

Authorized sellers may adjust inventory for their own variants.

Example:

```text
Current:
available = 10

Adjustment:
+5

Result:
available = 15
```

Or:

```text
Current:
available = 10

Adjustment:
-3

Result:
available = 7
```

Rules:

- Quantity cannot become negative.
- Adjustment must be explicit.
- Adjustment reason should be recorded.
- Ownership must be verified.
- Inventory changes should be auditable.

Potential reasons:

```text
RESTOCK
CORRECTION
DAMAGE
LOSS
RETURN
MANUAL_ADJUSTMENT
```

Do not allow arbitrary unvalidated reason strings if an enum/domain value is sufficient.

---

# 7. Reservation

Reservation is required for future Order/Checkout flows.

Conceptually:

```text
available = 10
reserved = 0

Reserve 3

available = 7
reserved = 3
```

Reservation must be atomic.

The system must never allow:

```text
available < 0
```

Reservation should fail when insufficient stock exists.

Example:

```text
available = 2

request reserve = 5

→ InsufficientStockError
```

---

# 8. Release Reservation

When a reservation is cancelled or expires:

```text
available = 7
reserved = 3

Release 2

available = 9
reserved = 1
```

Rules:

- Cannot release more than reserved quantity.
- Release must be atomic.
- Releasing the same reservation twice must not double-release stock.

This is one reason an explicit reservation model may be preferable to only storing counters.

---

# 9. Reservation Model

Before implementation, Task 5.1 must decide whether the MVP uses:

### Option A — Counters only

```text
inventory
├── available_quantity
└── reserved_quantity
```

or:

### Option B — Inventory + Reservation records

```text
inventory
    ↓
inventory_reservations
```

The recommended design is to introduce explicit reservation records because Orders will need traceable reservations and idempotent release/commit behavior.

Conceptually:

```text
inventory_reservations
├── id
├── inventory_id
├── reference_type
├── reference_id
├── quantity
├── status
├── expires_at
├── created_at
└── updated_at
```

The exact schema and reservation lifecycle must be finalized before coding.

---

# 10. Reservation Lifecycle

Recommended conceptual lifecycle:

```text
RESERVED
   ├── COMMITTED
   ├── RELEASED
   └── EXPIRED
```

Future Order flow may use:

```text
Cart/Checkout
     ↓
Reserve
     ↓
Order Created
     ↓
Commit Reservation
```

If checkout/order creation fails:

```text
Reservation
     ↓
Release
```

Do not implement Order behavior in this phase.

Only expose the inventory capability that future Order services can use.

---

# 11. Concurrency

Inventory is a high-concurrency domain.

The implementation must protect against overselling.

Bad approach:

```text
SELECT available_quantity
       ↓
Application calculates
       ↓
UPDATE inventory
```

Two concurrent requests can both see the same quantity.

Prefer an atomic database operation or row-level locking strategy.

For example conceptually:

```text
UPDATE inventory
SET available_quantity = available_quantity - :quantity,
    reserved_quantity = reserved_quantity + :quantity
WHERE id = :inventory_id
  AND available_quantity >= :quantity
```

Then verify affected rows.

Or use a properly scoped row lock inside a transaction.

The final strategy must be selected in Task 5.1.

---

# 12. Idempotency

Reservation and release operations must support safe retries.

This is important because:

```text
network timeout
message retry
request retry
worker retry
```

must not reserve or release stock twice.

Potential idempotency/reference key:

```text
reservation_id
reference_id
idempotency_key
```

The exact mechanism must be finalized in Task 5.1.

---

# 13. Inventory Status

Do not create unnecessary states.

Potential inventory state:

```text
ACTIVE
DISABLED
```

However, availability can usually be derived from quantity.

For MVP, consider whether an explicit status is actually necessary.

The design task must decide.

---

# 14. Seller Inventory APIs

Potential endpoints:

```text
GET   /seller/inventory
GET   /seller/inventory/:variantId
POST  /seller/inventory/:variantId/adjust
```

Potential reservation operations should NOT be exposed directly as generic seller APIs.

Reservations are application/business operations used by checkout/order workflows.

---

# 15. Admin Inventory APIs

Admin may need read-only visibility:

```text
GET /admin/inventory
GET /admin/inventory/:variantId
```

Admin modification should only exist if explicitly required.

Do not give Admin unrestricted stock mutation merely because Admin exists.

---

# 16. Public Inventory

Customers generally should not receive internal inventory details.

For catalog availability, expose derived information such as:

```text
in_stock: true
```

or:

```text
availability: IN_STOCK
```

Do not expose:

```text
available_quantity = 137
```

unless the marketplace explicitly requires it.

Public catalog behavior should be implemented in Catalog/Order-facing APIs, not by exposing internal inventory records.

---

# 17. Low Stock

Low-stock notifications may be a future feature.

Do not implement notifications in this phase unless required.

The inventory domain may expose a calculation such as:

```text
isLowStock(threshold)
```

only if there is a real consumer.

Do not create a notification subsystem prematurely.

---

# 18. Repository Strategy

Continue SQL-only repositories.

Potential ports:

```text
InventoryRepository
InventoryReservationRepository
```

No ORM.

No generic repository abstraction unless justified.

Repositories should support the concurrency strategy selected by the domain/application design.

---

# 19. Database Model

Conceptually:

```text
products
   ↓
product_variants
   ↓
inventory
   ↓
inventory_reservations
```

Potential tables:

```text
inventory
inventory_reservations
inventory_adjustments
```

The final choice between an adjustment/history table and audit-only records must be made in Task 5.1.

Important constraints:

- One inventory record per variant if using one-to-one inventory.
- Quantities cannot be negative.
- Reservation quantity must be positive.
- Reservation must reference valid inventory.
- Reservation status must be constrained.
- Idempotency/reference uniqueness must be enforced where required.

---

# 20. Inventory History

Inventory is financially/business significant.

Every adjustment should be traceable.

Potential record:

```text
inventory_adjustments
├── id
├── inventory_id
├── quantity_delta
├── reason
├── actor_id
├── reference_type
├── reference_id
├── created_at
└── correlation_id
```

This is different from generic audit logs.

The final design must decide whether inventory adjustments are:

- a dedicated immutable ledger/history, or
- represented only through the generic audit system.

For a marketplace, a dedicated adjustment history is recommended.

---

# 21. Transactions

Inventory mutations must use transactions where multiple records change.

Reservation:

```text
BEGIN

validate/reserve inventory
create reservation

COMMIT
```

Release:

```text
BEGIN

validate reservation
update inventory
update reservation

COMMIT
```

Adjustment:

```text
BEGIN

update inventory
create adjustment history

COMMIT
```

Keep transaction scope narrow.

---

# 22. Events / Outbox

Potential events:

```text
InventoryAdjusted
InventoryReserved
InventoryReleased
InventoryReservationExpired
```

Do not create all of them automatically.

Only publish events when a real consumer exists.

If required:

```text
BEGIN
  inventory mutation
  reservation/adjustment record
  outbox event
COMMIT
```

Then publish asynchronously.

---

# 23. Audit

Inventory mutations must be traceable.

Audit relevant actions:

```text
InventoryAdjusted
InventoryReserved
InventoryReleased
```

Do not log secrets.

Include:

```text
actor_id
inventory_id
variant_id
quantity
action
reason
reference_id
correlation_id
timestamp
```

Inventory adjustment history and generic audit logs may coexist because they serve different purposes.

---

# 24. Validation

Validate:

- Variant exists
- Variant belongs to a product
- Product belongs to authenticated seller
- Seller is allowed to manage inventory
- Quantity is a valid integer
- Quantity is positive where required
- Adjustment cannot create negative stock
- Reservation cannot exceed available stock
- Release cannot exceed reserved stock
- Reservation cannot be mutated after terminal state
- Idempotency/reference rules are satisfied

Never trust client-provided seller ownership.

---

# 25. Authorization

### Seller

Can:

- View own variant inventory
- Adjust own inventory
- View own inventory history

Cannot:

- Access another seller's inventory
- Reserve arbitrary inventory
- Release another party's reservation
- Change another seller's stock

### Admin

Initially:

- Read inventory
- View inventory history

Write access should only be added if the business requires it.

### System/Application

Order/checkout services will later be allowed to:

- Reserve stock
- Commit reservations
- Release reservations

This should happen through application ports, not public seller endpoints.

---

# 26. API Surface

Seller:

```text
GET  /seller/inventory
GET  /seller/inventory/:variantId
POST /seller/inventory/:variantId/adjust
GET  /seller/inventory/:variantId/adjustments
```

Admin:

```text
GET /admin/inventory
GET /admin/inventory/:variantId
```

Internal/application ports:

```text
reserve()
release()
commit()
```

These are capabilities for future application services, not necessarily HTTP endpoints.

---

# 27. Pagination

Use global cursor pagination for:

```text
Seller inventory list
Inventory adjustment history
Admin inventory list
```

Do not introduce module-specific pagination response shapes.

---

# 28. Testing Requirements

## Unit tests

Test:

- Quantity rules
- Adjustment rules
- Reservation rules
- Release rules
- Commit rules
- State transitions
- Idempotency behavior
- Seller ownership rules

## Integration tests

Test:

- Inventory creation
- Inventory retrieval
- Inventory adjustment
- Reservation
- Release
- Commit
- Invalid reservation
- Invalid release
- Unauthorized seller access
- Pagination

## Concurrency tests

Must test concurrent reservation attempts.

Example:

```text
Stock = 10

Request A reserves 7
Request B reserves 7

Expected:
one succeeds
one fails
final available = 3
```

The implementation must never result in:

```text
available = -4
```

or:

```text
reserved = 14
```

## Database tests

Verify:

- One inventory per variant
- Non-negative quantities
- Valid foreign keys
- Reservation constraints
- Unique idempotency/reference constraints where required

---

# 29. Acceptance Criteria

Phase 5 is complete only when:

- Inventory belongs to Variant.
- Product has no duplicated authoritative stock.
- Seller ownership is enforced.
- Sellers can safely adjust their own inventory.
- Inventory adjustments are traceable.
- Reservation capability exists.
- Release capability exists.
- Commit capability exists if required by the finalized design.
- Reservation is concurrency-safe.
- Overselling is prevented.
- Retry/idempotency behavior is safe.
- Quantities cannot become negative.
- Global pagination is used.
- SQL repositories are used.
- No ORM exists.
- DI is used.
- Required inventory events use Outbox.
- Tests cover concurrency and failure cases.
- The inventory API is ready for the future Order phase.

---

# 30. AI Task Breakdown

Do not implement the whole phase in one AI request.

## Task 5.1 — Inventory Domain Design

Finalize:

- Quantity model
- Inventory one-to-one relationship with Variant
- Reservation model
- Reservation lifecycle
- Commit semantics
- Concurrency strategy
- Idempotency strategy
- Inventory adjustment history
- Inventory status necessity
- Initial inventory creation behavior
- Public availability behavior

Create an ADR before coding.

## Task 5.2 — Inventory Persistence

Implement:

- Inventory domain
- Repository ports
- SQL repositories
- Migration
- Constraints
- Indexes
- Tests

## Task 5.3 — Inventory Creation

Implement the finalized inventory initialization flow for variants.

## Task 5.4 — Inventory Adjustment

Implement:

```text
POST /seller/inventory/:variantId/adjust
```

with ownership validation, transaction, history, audit, and tests.

## Task 5.5 — Inventory Queries

Implement:

```text
GET /seller/inventory
GET /seller/inventory/:variantId
GET /seller/inventory/:variantId/adjustments
```

using global pagination.

## Task 5.6 — Reservation

Implement the internal/application reservation capability:

```text
reserve()
```

with concurrency protection and idempotency.

## Task 5.7 — Release

Implement:

```text
release()
```

with safe retry behavior.

## Task 5.8 — Commit

Implement:

```text
commit()
```

if selected by Task 5.1.

## Task 5.9 — Admin Inventory Read Model/API

Implement read-only Admin inventory visibility if required.

## Task 5.10 — Events & Audit

Add required inventory events and audit/history.

## Task 5.11 — Concurrency & Security Review

Review:

- Overselling
- Race conditions
- Double reservation
- Double release
- Ownership
- Authorization
- Idempotency
- Transaction boundaries

## Task 5.12 — Phase Review

Run:

- Unit tests
- Integration tests
- Concurrency tests
- Database tests
- Security tests
- Architecture/dependency review

Do not start Phase 6 until this review passes.

---

# 31. Out of Scope

Do not implement in Phase 5:

- Cart
- Checkout
- Orders
- Payments
- Delivery
- Product search
- Notifications
- Low-stock notification system
- Warehouse management
- Multiple warehouses
- Purchase orders
- Supplier management
- Advanced stock forecasting
- Seller payouts
- Returns workflow
- Refund workflow

These can be introduced in later phases.
