# Marketplace Backend — Project Blueprint

## 1. Project Vision

A professional, modular e-commerce marketplace backend built incrementally with AI while minimizing rework and AI token/quota usage.

### Core principles

- Build the MVP completely before moving to post-MVP features.
- Use vertical slices and small, explicit tasks.
- Establish architecture and dependency rules before business features.
- No ORM.
- SQL is the source of truth for database access.
- `pkg/` is independent and must not import application code.
- Use dependency injection with `tsyringe`.
- Use PostgreSQL as the system of record.
- Use Redis for infrastructure concerns, not business truth.
- Use correlation IDs throughout requests, logs, and events.
- Use global error handling and global pagination conventions.
- Use transactions for multi-step business operations.
- Use an Outbox pattern for reliable event publishing.
- Use audit logging for sensitive business actions.

---

## 2. Marketplace Actors

### Customer

- Register/login
- Browse products
- View products and variants
- Manage cart
- Checkout
- Choose payment method
- Track orders
- Review products

### Seller

- Register
- Submit seller profile
- Wait for admin approval
- Manage products
- Manage variants
- Manage inventory
- View orders containing their products

### Admin

- Manage users
- Approve/reject sellers
- Manage categories
- Manage products
- Manage delivery agents
- Monitor orders
- Monitor payments

### Delivery Agent

- View assigned deliveries
- Accept delivery
- Pick up order
- Update delivery status
- Mark delivery as completed

---

## 3. Core Business Rules

### 3.1 Seller Approval

A seller cannot sell immediately after registration.

```text
REGISTER
   ↓
PENDING_APPROVAL
   ↓
ADMIN DECISION
   ├── APPROVED
   └── REJECTED
```

Only an approved and active seller can create/publish sellable products.

### 3.2 Product Ownership

Every product belongs to exactly one seller.

```text
Seller
  ├── Product A
  ├── Product B
  └── Product C
```

A product cannot be owned by multiple sellers.

### 3.3 Product Variants

Every product must have at least one variant.

The variant is the actual sellable unit.

```text
Product
  ├── Variant
  ├── Variant
  └── Variant
```

Variant-level data includes:

- SKU
- Price
- Inventory/stock
- Attributes
- Status

Keep the distinction clear:

```text
Product ≠ Variant ≠ Inventory
```

### 3.4 Payments

MVP payment methods:

- COD
- ONLINE

Payment has its own lifecycle and must not be tightly coupled to the order lifecycle.

Example payment states:

```text
PENDING
AUTHORIZED
PAID
FAILED
REFUNDED
```

### 3.5 Delivery

The marketplace manages delivery agents.

A delivery agent is not a seller.

Delivery has its own lifecycle, for example:

```text
UNASSIGNED
ASSIGNED
ACCEPTED
PICKED_UP
OUT_FOR_DELIVERY
DELIVERED
```

---

## 4. MVP Scope

Build the MVP fully before starting post-MVP functionality.

```text
Foundation
   ↓
Auth
   ↓
Users
   ↓
Sellers
   ↓
Categories
   ↓
Products
   ↓
Variants
   ↓
Inventory
   ↓
Cart
   ↓
Orders
   ↓
Payments
   ↓
Delivery
```

---

## 5. Architecture

Request flow:

```text
HTTP Request
     ↓
Middleware
     ├── Correlation ID
     ├── Authentication
     ├── Authorization
     ├── Validation
     └── Request Context
     ↓
Controller
     ↓
Application Service
     ├── Domain
     ├── Repository
     ├── Security Port
     ├── Transaction
     ├── Audit
     └── Outbox
     ↓
Infrastructure
     ├── PostgreSQL
     ├── Redis
     ├── Message Broker
     └── External Services
```

### Dependency direction

```text
Presentation
     ↓
Application
     ↓
Domain
```

Infrastructure implementations are injected through ports/interfaces.

Application code must not directly instantiate infrastructure dependencies.

---

## 6. `pkg/` Rules

`pkg/` is an independent reusable library layer.

It must not import:

- `app`
- domain code
- infrastructure code
- project-specific business logic

Allowed direction:

```text
app / infrastructure / lib
             ↓
            pkg
```

Potential areas:

```text
pkg/
├── cache/
├── email/
├── messaging/
└── utils/
```

---

## 7. Repository and SQL Strategy

No ORM.

Database flow:

```text
Repository
    ↓
SQL
    ↓
PostgreSQL
```

Repositories use explicit SQL queries.

Do not introduce an ORM abstraction.

Do not create a separate generic `queries/` directory for repository SQL. SQL belongs with the repository implementation where it is used.

---

## 8. Database Strategy

PostgreSQL is the source of truth.

Transactions are required for operations such as:

- Creating an order
- Creating order items
- Reserving inventory
- Creating payment records
- Creating outbox events

Example:

```text
BEGIN

business changes
inventory reservation
payment record
outbox event

COMMIT
```

Any failure must roll back the transaction.

---

## 9. Redis Strategy

Redis is infrastructure, not the business source of truth.

Primary uses:

- Caching
- Rate limiting
- Idempotency
- Distributed locks
- Temporary data
- Token/session-related infrastructure where appropriate

Business-critical state remains in PostgreSQL.

---

## 10. Correlation ID

Every request has a correlation ID.

Use an incoming `X-Correlation-ID` when supplied; otherwise generate one.

Propagate it through:

```text
HTTP
 ↓
Application
 ↓
Repositories / logs
 ↓
Events
 ↓
Message broker
```

This enables end-to-end request tracing.

---

## 11. Error Handling

Controllers should not contain repetitive error handling.

Use a global error pipeline:

```text
Domain/Application Error
        ↓
Global Error Handler
        ↓
HTTP Response
```

Examples:

```text
SellerNotApprovedError → 403
ProductNotFoundError → 404
InsufficientStockError → 409
```

Errors should have consistent structure and classification.

---

## 12. Pagination

All list endpoints use the global pagination strategy.

Preferred API shape:

```text
GET /products?limit=20&cursor=...
```

Response:

```json
{
  "data": [],
  "pagination": {
    "nextCursor": "...",
    "hasNextPage": true
  }
}
```

Cursor pagination should be preferred for large datasets when appropriate.

---

## 13. Dependency Injection

Use `tsyringe`.

The application must use a centralized composition root/container.

Avoid:

```ts
new ProductRepository()
```

inside application services.

Prefer dependency injection:

```text
DI Container
     ↓
Application Service
     ↓
Repository Port
     ↓
Repository Implementation
```

---

## 14. Outbox Pattern

Important domain events must use the Outbox pattern.

Do not rely on an independent database commit and message publish.

Preferred flow:

```text
Database Transaction
       ├── Business Data
       └── Outbox Event
              ↓
           COMMIT
              ↓
       Outbox Worker
              ↓
         Message Broker
```

Potential events:

- OrderCreated
- SellerApproved
- PaymentCompleted
- OrderDelivered

---

## 15. Audit

Sensitive business actions must be auditable.

Examples:

- Seller approved/rejected
- Product created/updated
- Order status changed
- Payment status changed
- Delivery assigned

Audit information should include, where applicable:

```text
actor
action
entity
entity_id
metadata
timestamp
correlation_id
```

---

## 16. Order Flow

```text
Customer
   ↓
Cart
   ↓
Checkout
   ↓
Validate Products
   ↓
Validate Inventory
   ↓
Create Order
   ↓
Reserve Inventory
   ↓
Create Payment
   ↓
Payment
   ├── COD
   └── ONLINE
   ↓
Order Confirmation
   ↓
Delivery Assignment
   ↓
Delivery Agent
   ↓
Delivered
```

---

## 17. Product Flow

```text
Approved Seller
      ↓
Create Product
      ↓
Create Variant(s)
      ↓
Assign SKU
      ↓
Set Price
      ↓
Set Inventory
      ↓
Publish Product
```

A product must have at least one valid, sellable variant before it can be purchased.

---

## 18. Seller Flow

```text
Seller Registration
        ↓
Seller Profile
        ↓
PENDING_APPROVAL
        ↓
Admin Review
     ┌──┴──┐
     ↓     ↓
APPROVED REJECTED
     ↓
Can Sell
```

---

## 19. Target Project Structure

```text
src/
├── app/
│   ├── auth/
│   ├── user/
│   ├── seller/
│   ├── category/
│   ├── product/
│   ├── inventory/
│   ├── cart/
│   ├── order/
│   ├── payment/
│   ├── delivery/
│   └── ...
│
├── lib/
│   ├── auth/
│   ├── cache/
│   ├── config/
│   ├── correlation/
│   ├── dependency-injection/
│   ├── error/
│   ├── events/
│   ├── http/
│   ├── idempotency/
│   ├── logger/
│   ├── transaction/
│   ├── validation/
│   └── ...
│
├── migrations/
├── pkg/
│   ├── cache/
│   ├── email/
│   ├── messaging/
│   └── utils/
│
├── routes.ts
├── app.ts
├── server.ts
└── worker.ts
```

---

## 20. AI Development Rules

AI must work in small, explicit tasks.

Never ask the AI to build the entire project at once.

For every task define:

1. Goal
2. Scope
3. Files allowed to change
4. Files that must not change
5. Architectural constraints
6. Acceptance criteria
7. Tests required

Development cycle:

```text
Architecture Decision
        ↓
Small Task
        ↓
Implementation
        ↓
Review
        ↓
Tests
        ↓
Commit
```

The AI must follow this blueprint and must not silently introduce architectural decisions that contradict it.

---

## 21. Phase Roadmap

### Phase 0 — Blueprint
This document.

### Phase 1 — Foundation
Project initialization and all cross-cutting infrastructure.

### Phase 2 — Auth
Registration, login, refresh tokens, password flows, authentication/authorization foundation.

### Phase 3 — Users & Sellers
Users, seller profiles, seller approval workflow.

### Phase 4 — Catalog
Categories, products, product variants.

### Phase 5 — Inventory
Variant inventory and stock operations.

### Phase 6 — Cart
Cart lifecycle and cart items.

### Phase 7 — Orders
Checkout and order creation.

### Phase 8 — Payments
COD and online payment lifecycle.

### Phase 9 — Delivery
Marketplace delivery agents and delivery lifecycle.

### Phase 10 — MVP Hardening
Testing, security, idempotency, observability, performance, edge cases, and production readiness.

### Phase 11 — Post-MVP
Advanced marketplace capabilities after the MVP is complete and stable.
