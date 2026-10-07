# Phase 6 — Cart & Checkout

## Goal

Build the Cart and Checkout domains on top of the completed Foundation, Authentication, Users & Sellers, Catalog, and Inventory phases.

This phase connects:

```text
Customer
   ↓
Cart
   ↓
Cart Items
   ↓
Variant
   ↓
Inventory
   ↓
Checkout
```

The critical principle is:

> Cart is mutable customer intent. Checkout is the controlled transition from that intent into an order-ready operation.

This phase prepares the system for the Order and Payment phases without implementing the final Order lifecycle or payment processing yet.

---

# 1. Scope

This phase contains:

- Customer cart
- Cart items
- Add/update/remove cart items
- Cart validation
- Product/variant availability checks
- Price snapshot preparation
- Checkout validation
- Inventory reservation during checkout
- Checkout idempotency
- Checkout transaction boundary
- Checkout result prepared for the future Order phase

This phase does NOT implement:

- Final Order domain
- Payment processing
- COD settlement
- Online payment gateway
- Delivery assignment
- Delivery agents
- Seller payouts

---

# 2. Core Concepts

## Cart

A Cart represents the customer's current shopping intent.

```text
Customer
   ↓
Cart
   ├── Item → Variant A
   ├── Item → Variant B
   └── Item → Variant C
```

A customer should normally have one active cart.

---

# 3. Cart Ownership

Every cart belongs to exactly one authenticated customer/user.

Rules:

- A user can access only their own cart.
- Client must never provide an arbitrary `user_id` for ownership.
- Ownership comes from the authenticated principal.
- Anonymous carts are out of scope for MVP unless explicitly added later.

Conceptually:

```text
Authenticated User
       ↓
Current Cart
```

---

# 4. Cart Item

A cart item references a Product Variant.

Recommended conceptual fields:

```text
id
cart_id
variant_id
quantity
created_at
updated_at
```

Do not treat the Product itself as the sellable item.

The Variant is the authoritative purchasable catalog unit.

---

# 5. Cart Quantity

Rules:

- Quantity must be a positive integer.
- Quantity cannot exceed configured limits.
- Quantity must be validated against current availability where appropriate.
- Cart operations must not directly decrement inventory.

Example:

```text
Add Variant A
quantity = 3
```

does NOT reserve stock.

Stock is reserved during Checkout.

---

# 6. Cart and Inventory

The cart does not own inventory.

```text
Cart
  ↓
Variant
  ↓
Inventory
```

When adding an item:

```text
Check variant exists
Check variant is active
Optionally check current availability
Add item
```

Do not reserve stock merely because the item is in the cart.

This avoids holding inventory indefinitely.

---

# 7. Cart and Price

Cart should not be treated as the permanent source of truth for product price.

Prices can change after a cart item is added.

Therefore, Checkout must re-read authoritative variant pricing.

Example:

```text
Cart added at:
1000 EGP

Current price:
1100 EGP

Checkout:
1100 EGP
```

The checkout response should clearly indicate price changes when applicable.

Do not silently charge an old cart price.

---

# 8. Cart APIs

Initial customer APIs:

```text
GET    /cart
POST   /cart/items
PATCH  /cart/items/:itemId
DELETE /cart/items/:itemId
DELETE /cart
```

The exact API naming must follow the global API conventions.

---

# 9. Add to Cart

Flow:

```text
Authenticated Customer
        ↓
Validate Variant
        ↓
Validate Variant is Active
        ↓
Load/Create Cart
        ↓
Add or Merge Item
        ↓
Return Cart
```

If the same Variant already exists:

```text
existing quantity + requested quantity
```

unless the final design explicitly chooses replacement semantics.

The final behavior must be decided in Task 6.1.

---

# 10. Update Cart Item

Allow quantity changes:

```text
PATCH /cart/items/:itemId
```

Rules:

- Item must belong to current user's cart.
- Quantity must be positive.
- Quantity must satisfy configured maximum.
- Variant must still be active.

Do not reserve stock during update.

---

# 11. Remove Cart Item

Removing an item:

```text
DELETE /cart/items/:itemId
```

simply removes customer intent.

There is no inventory release because the cart did not reserve inventory.

---

# 12. Clear Cart

Clearing the cart removes all cart items.

This should be idempotent.

```text
DELETE /cart
```

when the cart is already empty should not fail unnecessarily.

---

# 13. Cart Validation

Before Checkout, validate every cart item:

```text
Variant exists
AND
Variant is active
AND
Product is published
AND
Seller can sell
AND
Category is valid if required
AND
Quantity is valid
AND
Inventory is available
```

The final validation rules must be centralized rather than duplicated.

---

# 14. Checkout

Checkout is the transition from:

```text
Mutable Cart
```

to:

```text
Order-ready state
```

Conceptually:

```text
Cart
 ↓
Validate
 ↓
Re-price
 ↓
Reserve Inventory
 ↓
Create Checkout Result
 ↓
Order Phase
```

The actual Order record should be introduced in Phase 7 unless the project plan explicitly merges it with Checkout.

---

# 15. Checkout Request

The checkout request may include:

```text
shipping address
payment method
customer notes
```

The exact fields must be finalized in Task 6.1.

Important:

The server must calculate all monetary totals.

Never trust:

```text
client_total
client_subtotal
client_price
client_discount
```

---

# 16. Payment Method

The marketplace requires:

```text
COD
ONLINE
```

This phase should accept and validate the selected method but should not implement payment processing.

Conceptually:

```text
payment_method:
  COD
  ONLINE
```

The final Payment domain will handle the actual payment behavior.

---

# 17. COD

For:

```text
payment_method = COD
```

Checkout should prepare the order for a future Order flow.

No online payment transaction is required.

The final Order phase will define:

```text
COD order
→ awaiting fulfillment
```

---

# 18. ONLINE

For:

```text
payment_method = ONLINE
```

Checkout must not fake payment success.

It should prepare the payment requirement for the future Payment phase.

Example:

```text
Checkout
   ↓
Payment Required
   ↓
Payment Phase
```

Do not call an external payment gateway in Phase 6.

---

# 19. Shipping Address

Checkout needs a destination.

For MVP, decide whether the address is:

### Option A

Submitted as part of checkout and stored/snapshotted.

### Option B

Stored as a customer address entity and selected during checkout.

The preferred long-term design is a customer address entity plus a checkout-time snapshot.

The exact design must be finalized in Task 6.1.

---

# 20. Address Snapshot

Future Orders must not depend on a mutable customer address record.

Example:

```text
Customer Address
     ↓
Checkout
     ↓
Order Address Snapshot
```

If the customer later changes their address, an existing Order must retain the original destination.

Phase 6 should prepare the data required for this behavior.

---

# 21. Pricing

Checkout must calculate:

```text
subtotal
shipping_cost
discount
total
currency
```

Only fields actually required by MVP should be implemented.

Do not implement promotions/discount engines yet unless required.

For MVP:

```text
subtotal
+
shipping
=
total
```

if no discount system exists.

---

# 22. Money

Continue the money representation defined in Catalog.

Do not use JavaScript floating-point arithmetic for monetary values.

Example conceptual representation:

```text
amount_minor: 100000
currency: EGP
```

All calculations must use the agreed money abstraction.

---

# 23. Price Snapshot

During Checkout, capture authoritative variant pricing.

Conceptually:

```text
Checkout Item
├── variant_id
├── quantity
├── unit_price
└── subtotal
```

This becomes the foundation for the future Order item snapshot.

Do not depend on future catalog changes after checkout.

---

# 24. Inventory Reservation

Checkout is the first real consumer of Inventory reservation.

Flow:

```text
Checkout
   ↓
Validate Cart
   ↓
Calculate Prices
   ↓
Reserve Inventory
   ↓
Persist Checkout/Order-ready state
```

Reservation must be:

- Atomic
- Concurrency-safe
- Idempotent
- Traceable

Use the inventory capability from Phase 5.

Do not directly modify inventory tables from Checkout.

Preferred:

```text
Checkout Application Service
        ↓
InventoryService / InventoryPort
        ↓
Inventory Domain
        ↓
Inventory Repository
```

---

# 25. Reservation Failure

If any item cannot be reserved:

```text
Checkout
   ↓
Reservation attempt
   ↓
Insufficient Stock
   ↓
Release previously reserved items
   ↓
Fail Checkout
```

This must be transactionally or operationally safe.

Example:

```text
Item A → reserve 2 ✓
Item B → reserve 5 ✗

Result:
release Item A reservation
checkout fails
```

Never leave partial reservations accidentally.

---

# 26. Checkout Idempotency

Checkout must support retries safely.

Example:

```text
Client sends checkout
      ↓
Server processes
      ↓
Network timeout
      ↓
Client retries same request
```

The retry must not:

- Reserve inventory twice
- Create duplicate checkout results
- Create duplicate payment requirements
- Eventually create duplicate orders

Use an idempotency key.

Conceptually:

```text
Idempotency-Key: <unique-key>
```

The exact persistence and lifecycle must be finalized in Task 6.1.

---

# 27. Checkout State

Recommended conceptual state:

```text
INITIATED
VALIDATING
RESERVING
READY
FAILED
EXPIRED
```

However, do not create a complex state machine unless required.

Since the actual Order is introduced later, Phase 6 should keep Checkout state minimal.

The final model must be finalized in Task 6.1.

---

# 28. Cart Clearing

After a successful Checkout, the cart should no longer contain the checked-out quantities.

However, the exact timing matters.

Preferred conceptual flow:

```text
Validate
  ↓
Reserve
  ↓
Create checkout/order-ready state
  ↓
Clear cart
```

This must happen safely so a failure does not leave an inconsistent cart.

The exact transaction boundary must be finalized in Task 6.1.

---

# 29. Transactions

Checkout is a multi-resource operation.

Potential transaction:

```text
BEGIN

validate cart
calculate totals
reserve inventory
create checkout/order-ready record
clear cart
create outbox event if needed

COMMIT
```

However, inventory reservation may involve a separate transaction boundary depending on the Phase 5 implementation.

Do not create distributed transactions.

The architecture must define the consistency strategy explicitly.

---

# 30. Outbox

Potential events:

```text
CheckoutCreated
CheckoutReady
CheckoutFailed
```

Do not publish events unless there is a real consumer.

If an event is required, use:

```text
Database Change
+
Outbox Record
```

in the same transaction.

---

# 31. Audit

Audit security/business-sensitive checkout actions:

```text
CheckoutInitiated
CheckoutSucceeded
CheckoutFailed
```

Do not store:

- payment credentials
- raw card data
- secrets
- raw authentication tokens

---

# 32. Authorization

Customer:

- Can access own cart.
- Can modify own cart.
- Can checkout own cart.

Seller:

- No direct access to customer carts.

Admin:

- No unrestricted ability to manipulate customer carts.

All ownership checks must happen server-side.

---

# 33. Repository Strategy

Continue SQL-only repositories.

Potential ports:

```text
CartRepository
CartItemRepository
CheckoutRepository
IdempotencyRepository
```

Do not expose database details to application services.

Do not use ORM.

---

# 34. Database Model

Potential tables:

```text
carts
cart_items
checkout_sessions
checkout_items
idempotency_keys
```

The exact schema must be finalized in Task 6.1.

Potential relationships:

```text
users
  ↓
carts
  ↓
cart_items
  ↓
product_variants
```

Checkout:

```text
checkout_sessions
      ↓
checkout_items
      ↓
product_variants
```

---

# 35. Cart Constraints

Important constraints:

- One active cart per user.
- A cart item references one variant.
- Same variant should not appear twice in one cart.
- Quantity must be positive.
- Cart item belongs to its cart.
- Cart belongs to its user.

Prefer database constraints for invariants.

---

# 36. Checkout Constraints

Important constraints:

- Checkout belongs to one user.
- Checkout has one payment method.
- Checkout contains one or more items.
- Quantity is positive.
- Unit price is captured at checkout.
- Currency is captured.
- Idempotency key is unique within the required scope.
- Checkout cannot be completed twice.

---

# 37. API Response Design

Cart response should provide enough information for the customer:

```text
cart
├── items
│   ├── variant
│   ├── quantity
│   ├── unit_price
│   └── subtotal
├── subtotal
└── currency
```

Do not expose internal inventory counters.

Checkout response should include:

```text
checkout_id
status
items
totals
payment_method
shipping_information
```

The final response contract must be defined in Task 6.1.

---

# 38. Pagination

Cart normally does not require pagination for MVP.

For future/admin checkout listings, use the global pagination mechanism.

Do not introduce a special cart pagination system.

---

# 39. Testing Requirements

## Unit tests

Test:

- Cart ownership
- Add item
- Merge duplicate variant
- Update quantity
- Remove item
- Clear cart
- Checkout validation
- Price calculation
- Payment method validation
- Idempotency behavior

## Integration tests

Test:

- Create/get cart
- Add item
- Update item
- Remove item
- Checkout with COD
- Checkout with ONLINE
- Price changes between cart and checkout
- Variant becoming inactive
- Seller becoming unable to sell
- Insufficient stock
- Reservation failure
- Successful reservation
- Cart clearing after success

## Concurrency tests

Test:

- Two checkouts competing for the same stock.
- Duplicate checkout requests with the same idempotency key.
- Retry after network-like failure.

Expected:

- No overselling.
- No duplicate checkout.
- No duplicate reservation.

---

# 40. Acceptance Criteria

Phase 6 is complete only when:

- Authenticated customers have an active cart.
- Cart ownership is enforced.
- Cart supports add/update/remove/clear.
- Same variant handling is deterministic.
- Cart does not reserve inventory.
- Checkout revalidates catalog state.
- Checkout uses authoritative variant pricing.
- COD and ONLINE are supported as payment methods.
- Online payment is not falsely marked successful.
- Shipping information is captured according to the finalized design.
- Inventory is reserved through the Inventory abstraction.
- Partial reservation is safely rolled back/released.
- Checkout is idempotent.
- Cart is safely cleared after successful checkout.
- SQL repositories are used.
- No ORM exists.
- DI is used.
- Global errors are used.
- Correlation ID is propagated.
- Required events use Outbox.
- Tests cover concurrency and retry behavior.

---

# 41. AI Task Breakdown

Do not implement the entire phase in one AI request.

## Task 6.1 — Cart & Checkout Domain Design

Finalize:

- One-cart-per-user rule
- Duplicate variant behavior
- Cart quantity limits
- Checkout state
- Checkout persistence model
- Payment method representation
- Address model
- Address snapshot strategy
- Price snapshot strategy
- Idempotency design
- Inventory reservation consistency
- Cart clearing transaction boundary
- Failure/retry behavior

Create an ADR before coding.

## Task 6.2 — Cart Persistence

Implement:

- Cart domain
- Cart item domain
- Repository ports
- SQL repositories
- Migrations
- Constraints
- Tests

## Task 6.3 — Cart APIs

Implement:

```text
GET /cart
POST /cart/items
PATCH /cart/items/:itemId
DELETE /cart/items/:itemId
DELETE /cart
```

with ownership and validation.

## Task 6.4 — Checkout Persistence

Implement:

- Checkout model
- Checkout item model
- Repository ports
- SQL repositories
- Migration
- Constraints
- Tests

## Task 6.5 — Checkout Validation & Pricing

Implement:

- Cart validation
- Variant validation
- Seller eligibility validation
- Price re-evaluation
- Money calculation
- Payment method validation

## Task 6.6 — Checkout Inventory Reservation

Integrate the Phase 5 inventory reservation capability.

Implement:

- Reservation orchestration
- Failure rollback/release
- Concurrency-safe behavior
- Tests

## Task 6.7 — Checkout Idempotency

Implement:

```text
Idempotency-Key
```

with persistent idempotency handling.

## Task 6.8 — Checkout API

Implement the final checkout endpoint according to Task 6.1.

## Task 6.9 — Cart Clearing & Consistency

Implement the finalized post-checkout cart behavior.

## Task 6.10 — Audit & Outbox

Add required audit records and events only where justified.

## Task 6.11 — Security & Concurrency Review

Review:

- Cart ownership
- Price tampering
- Inventory race conditions
- Duplicate checkout
- Idempotency
- Partial reservations
- Payment method manipulation
- Address manipulation

## Task 6.12 — Phase Review

Run:

- Unit tests
- Integration tests
- Concurrency tests
- Database tests
- Security tests
- Architecture/dependency review

Do not start Phase 7 until this review passes.

---

# 42. Out of Scope

Do not implement in Phase 6:

- Final Order lifecycle
- Payment gateway integration
- Payment webhooks
- COD collection
- Delivery agent assignment
- Shipment creation
- Delivery tracking
- Seller payouts
- Commissions
- Coupons
- Promotions
- Discounts engine
- Returns
- Refunds
- Reviews
- Notifications
- Guest cart
