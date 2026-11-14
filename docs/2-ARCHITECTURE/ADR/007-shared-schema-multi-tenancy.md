# ADR 007: Shared-Schema Multi-Tenancy (`tenant_id` + PostgreSQL RLS)

**Status:** Accepted  
**Date:** 2026-11-14  
**Deciders:** Product + Platform Engineering  
**Supersedes:** ADR 004 for the SaaS product only (the archived single-tenant product keeps ADR 004)

## Context

The current `main` codebase is a single-tenant product deployed as one Docker stack per client. The new `EcoMate` repository is a separate SaaS product that must serve many tenants from one platform, with a self-serve landing page, a SaaS admin panel, dynamic plans, and subscription billing.

There are **no existing clients to migrate**. The initial SaaS conversion therefore starts from the current `main` schema with a greenfield baseline: no backfill, no tenant-data migration, and no need to preserve legacy tenant IDs.

The platform must support:

- one shared tenant database with strictly isolated tenant data;
- a separate control plane for tenants, plans, subscriptions, invoices, manual payments, domains and audit;
- dynamic plans whose features and limits are editable from the SaaS admin;
- tenant subdomains on `ecomate.bd`, optional additional base domains, and a configurable fallback domain;
- a later port of the central-commerce / multi-store feature (WooCommerce, Shopify, custom bridge) without weakening isolation.

## Decision

1. **One shared tenant database** (`ecomate`) for all tenant data. Every tenant-scoped table carries `tenant_id UUID NOT NULL` and is protected by PostgreSQL **Row-Level Security**.
2. **A separate platform database** (`ecomate_platform`) owns tenants, domains, plans, features, subscriptions, invoices, payments, usage, audit and platform users.
3. **Tenant resolution is host-based.** A request is mapped to a tenant from the `Host` header (custom domain or `{slug}.<base>`), then the tenant ID is placed in `AsyncLocalStorage` for the rest of the request.
4. **Per-tenant Prisma clients** connect with a session-level `app.tenant_id`; the application role is not the table owner and has no `BYPASSRLS`. A migration role owns DDL and controlled backfills.
5. **Entitlements replace the KeyMate/Keygen license server.** Feature checks keep their existing decorators/keys; the source of truth becomes the platform subscription + plan version + overrides.
6. **Central commerce is deferred.** When the upstream `feat/central-commerce` branch is final, it is ported as additive migrations that include `tenant_id`, RLS policies and triggers in the first migration.
7. **Domain configuration is data.** `ecomate.bd` is the primary domain; additional base domains and a fallback domain are stored in `PlatformSetting` and editable from the SaaS admin. Env values only bootstrap the configuration.

## Consequences

### Positive

- One schema, one migration path for all tenants (no per-tenant migration fan-out).
- Lower infrastructure cost than one stack per tenant.
- A single platform admin can manage tenants, plans, subscriptions and domains.
- Tenant data is isolated at the database level, not only by application code.

### Negative / costs

- Every tenant query is subject to RLS; indexes and connection settings must be correct for performance.
- Unique constraints must be reviewed one by one (tenant-composite vs intentional global).
- Connection management: per-tenant pools must be bounded, and PgBouncer transaction mode is incompatible with session-level tenant GUCs.
- Storefront pages become tenant/host-aware; static generation must be replaced with dynamic rendering + tenant-scoped cache tags.
- Backups and offboarding need a per-tenant export/purge tool; a tenant must never receive a full `pg_dump`.
- A future central-commerce port must be re-tenanted, including webhook/install/bridge tenant resolution.

### Mitigations

- RLS coverage CI gate; startup fail-fast check.
- A two-tenant isolation test suite that attempts cross-tenant reads, writes and raw SQL.
- An explicit global-unique allowlist.
- Per-tenant Prisma pools with a bounded LRU; session-mode PgBouncer only.
- Tenant-scoped export/purge scripts.
- A central-commerce port checklist that is applied before the feature is enabled.

## Alternatives considered

| Alternative | Why not now |
|---|---|
| **Silo: one database/stack per tenant** | Strongest isolation, but higher cost and slower provisioning; retained for the archived single-tenant product, not the SaaS default. |
| **Shared database without RLS** | Fastest to code, but a single missed `where` leaks tenant data. Rejected for a public multi-tenant SaaS. |
| **Schema-per-tenant** | Viable middle ground, but more migration/connection complexity than shared schema and less attractive than the chosen RLS model for the current team. |

## Implementation references

- Conversion plan: `~/.commandcode/plans/saas-multi-tenant-platform.md` and `docs/Commandcode/EcoMate SaaS — Multi-Tenant Conversion Plan`.
- Domain/runbook: `SAAS.md`.
- Tenant column/RLS pattern, Prisma manager, Better Auth per tenant, storefront host resolution and the deferred central-commerce contract are specified in the plan (§3 and §5).
