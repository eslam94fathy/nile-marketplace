# Phase 4 — Catalog: Categories, Products & Variants

## Goal

Build the marketplace catalog domain on top of the completed Foundation, Authentication, and Users & Sellers phases.

This phase introduces:

- Categories
- Products
- Product ownership by Seller
- Product Variants
- SKU
- Variant pricing
- Variant attributes
- Product publishing lifecycle

The critical business rules are:

1. Every Product belongs to exactly one Seller.
2. Every Product must have at least one Variant before it can become sellable.
3. Only an approved/active Seller can create and publish sellable Products.
4. Inventory belongs to the Variant, not directly to the Product.
5. Product and Variant are separate domain concepts.

---

# 1. Scope

### Categories

- Create category
- Update category
- List categories
- Get category
- Category hierarchy if required by the final design
- Activate/deactivate category

### Products

- Create product
- Update product
- Get product
- List products
- Seller-owned products
- Product lifecycle/status
- Publish/unpublish product

### Variants

- Create variant
- Update variant
- Get variant
- List product variants
- SKU
- Price
- Attributes
- Variant status

### Admin

- Manage categories
- Moderate catalog where required

---

# 2. Core Business Rules

## 2.1 Product Ownership

Every product has exactly one seller.

```text
Seller
   │
   ├── Product
   ├── Product
   └── Product
```

A product cannot belong to multiple sellers.

The product should persist a seller reference with a database-level foreign key.

---

## 2.2 Seller Eligibility

A product may only be created/published by a seller who satisfies the reusable seller business rule from Phase 3:

```text
SellerCanSell
```

The catalog must not duplicate seller approval logic.

Preferred:

```text
Product Application Service
        ↓
SellerCanSell
```

---

## 2.3 Product vs Variant

Product is the catalog-level entity.

Variant is the actual sellable SKU/unit.

```text
Product
   ├── Variant A
   ├── Variant B
   └── Variant C
```

Example:

```text
Product:
Nike Air Max

Variants:
- Size 40 / Black
- Size 41 / Black
- Size 42 / White
```

---

## 2.4 Variant Owns Sellable Data

Variant-level fields should include, where applicable:

```text
SKU
Price
Attributes
Status
```

Stock/inventory belongs to the Inventory domain and is associated with the Variant.

Do not duplicate stock on Product.

---

## 2.5 Every Product Needs a Variant

A product cannot become sellable without at least one valid variant.

Preferred lifecycle:

```text
DRAFT
  ↓
has valid variant
  ↓
PUBLISHED
```

The exact lifecycle must be finalized in Task 4.1.

---

# 3. Product Lifecycle

Recommended initial states:

```text
DRAFT
PUBLISHED
UNPUBLISHED
ARCHIVED
```

Potential transitions:

```text
DRAFT → PUBLISHED
PUBLISHED → UNPUBLISHED
UNPUBLISHED → PUBLISHED
PUBLISHED → ARCHIVED
DRAFT → ARCHIVED
```

Do not allow invalid transitions.

The domain owns transition rules.

Controllers must not directly modify status fields.

---

# 4. Variant Lifecycle

Recommended:

```text
ACTIVE
INACTIVE
```

A variant must be active to be sellable.

A Product is not considered sellable merely because the product itself is published.

The product must have at least one valid active variant.

---

# 5. SKU

SKU belongs to the Variant.

Rules:

- SKU must be unique according to the marketplace scope.
- Prefer a database unique constraint.
- SKU should not be generated from product names unless explicitly required.
- SKU format should be finalized in Task 4.1.
- SKU should be treated as a stable business identifier.

Example:

```text
Product
  ↓
Variant
  ↓
SKU: NIKE-AM42-BLK
```

---

# 6. Pricing

Price belongs to the Variant.

Do not store the authoritative sell price only on Product.

Example:

```text
Product
  ├── Variant A → 1000
  ├── Variant B → 1100
  └── Variant C → 1250
```

The price representation must avoid floating-point monetary errors.

Use an integer minor-unit representation or another explicitly defined money value object.

Example:

```text
amount: 100000
currency: EGP
```

The exact money representation must be finalized before implementation.

---

# 7. Variant Attributes

Variants may differ by attributes such as:

```text
size
color
material
storage
```

The implementation must define a consistent representation.

Do not create arbitrary JSON blobs without a clear querying/indexing strategy.

The exact attribute model must be decided in Task 4.1.

Potential conceptual model:

```text
Variant
   ↓
Variant Attributes
   ├── Size = 42
   └── Color = Black
```

---

# 8. Categories

Products may belong to categories.

The category model must be designed before implementation.

Potential hierarchy:

```text
Electronics
  ├── Phones
  │    ├── Android
  │    └── iPhone
  └── Laptops
```

The implementation should support hierarchy if marketplace requirements need it.

Avoid overengineering category trees if a simple flat structure is sufficient for the MVP.

---

# 9. Category Rules

Potential fields:

```text
id
name
slug
parent_id
status
created_at
updated_at
```

Rules:

- Name uniqueness must be defined.
- Slug uniqueness must be defined.
- A category cannot be its own parent.
- Cycles must not be allowed in a hierarchical model.
- Deactivation behavior must be defined.

Do not allow arbitrary users to modify categories.

Category management is an Admin capability.

---

# 10. Product Data

Potential product fields:

```text
id
seller_id
category_id
name
slug
description
status
created_at
updated_at
published_at
```

The exact fields must be finalized during Task 4.1.

Do not add speculative fields such as:

- rating
- review_count
- sales_count
- search_score
- popularity

Those belong to later concerns or derived data.

---

# 11. Product APIs

Initial seller-facing APIs:

```text
POST   /products
GET    /products/:id
PATCH  /products/:id
GET    /products
POST   /products/:id/publish
POST   /products/:id/unpublish
```

Seller-specific listing/filtering may use:

```text
GET /seller/products
```

or a consistent ownership filter under the global product route.

Do not create duplicate endpoints without a real reason.

---

# 12. Variant APIs

Potential endpoints:

```text
POST   /products/:productId/variants
GET    /products/:productId/variants
GET    /products/:productId/variants/:variantId
PATCH  /products/:productId/variants/:variantId
POST   /products/:productId/variants/:variantId/activate
POST   /products/:productId/variants/:variantId/deactivate
```

The final route design must follow the project's API conventions.

---

# 13. Category APIs

Admin:

```text
POST   /admin/categories
GET    /admin/categories
GET    /admin/categories/:id
PATCH  /admin/categories/:id
POST   /admin/categories/:id/activate
POST   /admin/categories/:id/deactivate
```

Public:

```text
GET /categories
GET /categories/:id
```

Exact API surface should remain minimal for MVP.

---

# 14. Authorization

### Seller

A seller can:

- Create their own products.
- Modify their own products.
- Create/modify variants of their own products.
- Publish/unpublish their own products if business rules permit.

A seller cannot:

- Modify another seller's product.
- Modify category management.
- Change product ownership.
- Change privileged catalog fields owned by Admin.

### Admin

Admin can:

- Manage categories.
- Moderate products where required.
- Access catalog administration.

Authorization must be server-side.

---

# 15. Product Ownership Security

Every seller mutation must verify ownership.

Conceptually:

```text
Authenticated Seller
       ↓
Product ID
       ↓
Load Product
       ↓
product.seller_id == authenticated_seller_id
       ↓
Allow mutation
```

Do not trust a `seller_id` sent by the client.

For product creation, derive the seller from the authenticated principal.

---

# 16. Product Publishing

Publishing should validate:

```text
SellerCanSell
AND
Product is valid
AND
Product has at least one active variant
AND
Required product fields exist
AND
Category is valid/active
```

Then:

```text
DRAFT
  ↓
PUBLISHED
```

Do not let the controller bypass these rules.

---

# 17. Product Deletion

Do not hard-delete products casually.

The initial design should prefer lifecycle-based deactivation/archive when historical references may exist.

Because future orders will reference products/variants, destructive deletion must be carefully constrained.

The final delete/archive policy must be decided in Task 4.1.

---

# 18. Repository Strategy

Continue the SQL-only approach.

Potential ports:

```text
CategoryRepository
ProductRepository
VariantRepository
```

Repositories use explicit SQL.

No ORM.

Do not introduce a generic repository abstraction merely to reduce lines of code.

---

# 19. Database Model

Conceptually:

```text
users
  │
  └── seller_profiles
          │
          └── products
                 │
                 ├── variants
                 │
                 └── category
```

Potential tables:

```text
categories
products
product_variants
```

The exact schema must be finalized before migrations are written.

Important constraints:

- Product must reference one seller.
- Variant must reference one product.
- SKU must be unique.
- Product/category references must be valid.
- Ownership must be enforceable at persistence level where appropriate.

---

# 20. Transactions

Simple product/variant CRUD operations should not use broad transactions unnecessarily.

Transactions are required when multiple dependent writes must succeed atomically.

Example:

```text
Create Product
+
Create initial Variant(s)
```

If the API guarantees that product creation and first variant creation happen together, use a transaction.

Otherwise, allow:

```text
Create Product as DRAFT
        ↓
Create Variant
        ↓
Publish Product
```

The exact flow must be finalized in Task 4.1.

---

# 21. Events / Outbox

Potential events:

```text
ProductCreated
ProductPublished
ProductUnpublished
ProductArchived
VariantCreated
VariantUpdated
```

Do not introduce events without a real consumer.

If an event is required:

```text
BEGIN
  catalog change
  outbox event
COMMIT
```

Then publish asynchronously.

---

# 22. Audit

Audit important catalog actions:

```text
ProductCreated
ProductUpdated
ProductPublished
ProductUnpublished
ProductArchived
VariantCreated
VariantUpdated
```

Admin category actions should also be auditable.

Include:

```text
actor_id
entity_id
action
previous_state where useful
new_state where useful
metadata
correlation_id
timestamp
```

---

# 23. Pagination

All catalog list endpoints must use the global pagination system.

Examples:

```text
GET /products?limit=20&cursor=...
GET /categories?limit=20&cursor=...
GET /admin/sellers?limit=20&cursor=...
```

Do not create module-specific pagination formats.

---

# 24. Filtering and Sorting

MVP filtering should be minimal and intentional.

Potential product filters:

```text
category
seller
status where authorized
price range if required
```

Potential sorting:

```text
created_at
price
name
```

Do not implement a full search engine in this phase.

Do not introduce Elasticsearch/OpenSearch yet.

---

# 25. Validation

Product validation should include:

- Required name
- Valid category
- Seller eligibility
- Valid status transition
- Valid variant data
- Unique SKU
- Valid money values
- Valid attributes
- Ownership checks

Never trust client-provided:

```text
seller_id
ownership
status transition
```

---

# 26. Testing Requirements

## Unit tests

Test:

- Product ownership rules
- SellerCanSell integration at application boundary
- Product state transitions
- Variant state transitions
- Publish eligibility
- SKU rules
- Money rules
- Category rules
- Attribute rules

## Integration tests

Test:

- Create product
- Update own product
- Reject modification of another seller's product
- Create variant
- Update variant
- Publish product
- Reject publishing without valid variant
- Category CRUD as Admin
- Public category/product reads
- Pagination

## Database tests

Verify:

- Product → seller foreign key
- Variant → product foreign key
- Unique SKU
- Category constraints
- Indexes
- Relevant status constraints

## Security tests

Verify:

- Seller cannot modify another seller's product.
- Seller cannot change product ownership.
- Non-admin cannot manage categories.
- Unapproved seller cannot publish.
- Invalid product states are rejected.

---

# 27. Acceptance Criteria

Phase 4 is complete only when:

- Categories work.
- Products work.
- Every product belongs to exactly one seller.
- Seller ownership is enforced.
- Only eligible sellers can manage sellable products.
- Variants work.
- Every published product has at least one active variant.
- SKU is unique.
- Variant price is represented safely.
- Variant attributes have a defined structure.
- Product lifecycle is enforced by domain rules.
- Category management is protected by Admin authorization.
- Global pagination is used.
- SQL repositories are used.
- No ORM exists.
- DI is used.
- Critical catalog actions are auditable.
- Required events use Outbox.
- Tests cover success, failure, ownership, authorization, and state transitions.

---

# 28. AI Task Breakdown

Do not implement this phase in one AI request.

## Task 4.1 — Catalog Domain Design

Finalize:

- Category model
- Category hierarchy decision
- Product fields
- Product lifecycle
- Variant lifecycle
- Product creation flow
- Product publishing rules
- SKU strategy
- Money representation
- Variant attribute model
- Product deletion/archive policy
- Category deactivation behavior

Create an ADR before coding.

## Task 4.2 — Category Persistence

Implement:

- Category domain
- Repository port
- SQL repository
- Migration
- Constraints/indexes
- Tests

## Task 4.3 — Category APIs

Implement Admin category management and public category reads.

## Task 4.4 — Product Persistence

Implement:

- Product domain
- Product repository port
- SQL repository
- Migration
- Constraints/indexes
- Tests

## Task 4.5 — Product CRUD

Implement:

```text
POST /products
GET /products/:id
PATCH /products/:id
GET /products
```

including ownership and authorization.

## Task 4.6 — Variant Persistence

Implement:

- Variant domain
- Variant repository port
- SQL repository
- Migration
- SKU constraints
- Tests

## Task 4.7 — Variant APIs

Implement variant creation, update, activation, deactivation, and listing.

## Task 4.8 — Product Publishing

Implement:

```text
POST /products/:id/publish
POST /products/:id/unpublish
```

with all domain validation.

## Task 4.9 — Catalog Audit & Events

Add required audit records and Outbox events only where justified.

## Task 4.10 — Catalog Security Review

Review:

- Ownership
- Authorization
- Seller approval
- State transitions
- SKU uniqueness
- Race conditions
- Input validation

## Task 4.11 — Phase Review

Run:

- Unit tests
- Integration tests
- Database tests
- Security tests
- Architecture/dependency review

Do not start Phase 5 until this review passes.

---

# 29. Out of Scope

Do not implement in Phase 4:

- Inventory
- Stock reservation
- Cart
- Orders
- Payments
- Delivery
- Reviews
- Ratings
- Search engine
- Product recommendations
- Seller payouts
- Commissions
- Advanced pricing/promotions
- Coupons
- Product images/media processing unless explicitly added as an MVP requirement
