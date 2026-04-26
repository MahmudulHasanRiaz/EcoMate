# Discovery & Baseline Report

**Date**: 2026-01-10
**Environment**: Development (Local)

## Database Baseline
Current row counts in local development environment:
- **Order**: 1
- **Product**: 5
- **LedgerEntry**: 35
- **InventoryItem**: 5
- **Expense**: 1

> [!NOTE]
> The local database is effectively empty. Performance testing logic must rely on synthetic data or production replicas.

## Indexing Status
- `pg_trgm` extension: **MISSING** / Not Enabled.
- **Order Table Indexes**:
  - Present: `createdAt`, `courierService`, `businessId`
  - Missing: `GIN` index for fuzzy search, `trgm` indexes for `customerName`, `customerPhone` optimization.

## Query Restrictions & Patterns (Code Analysis)
- **Heavy Endpoints identified**:
  - `/api/orders`: Likely uses `include: { products: true, customer: true }` without strict field selection.
  - **WooSync**: Logic likely fetches individual orders sequentially (N+1 risk).

## Recommendations (Input for Phase 1 & 2)
1.  **Immediate**: Apply `pg_trgm` migration.
2.  **Pagination**: Ensure `take` and `skip` are used, but plan to switch to `cursor` for reliability.
3.  **Seeding**: Need to seed at least 1000 orders to verify index effectiveness locally.
