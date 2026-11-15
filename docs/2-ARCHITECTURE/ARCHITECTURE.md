# EcoMate Architecture Overview

> **Status:** Draft  
> **Authority:** Supersedes architectural claims in historical plans  
> **Cross-reference:** See ADR files in `docs/2-ARCHITECTURE/ADR/` for decision records

## High-Level Architecture

**Monorepo:** 4 apps + shared packages

```
ecomate-web/
├── apps/
│   ├── backend/       # NestJS + Fastify + Prisma — API server
│   ├── admin/         # Next.js + Shadcn — Admin dashboard
│   ├── storefront/    # Next.js — Customer-facing store
│   └── pos/           # Next.js — Point of Service terminal
├── packages/

│   ├── feature-flags/ # Feature flag evaluation engine
│   └── shared/        # Shared types, utilities
├── clients/
│   └── client-example/ # Template for per-client deployments
└── docs/              # Documentation (this structure)
```

## Tech Stack

| Layer | Technology | Status |
|-------|-----------|--------|
| API Framework | NestJS 11 + Fastify (`@nestjs/platform-fastify`) | Verified |
| ORM | Prisma 7.9.1 | Verified |
| Database | PostgreSQL (16+) | Verified |
| Cache/Queue | Redis + BullMQ | Verified |
| Auth | Legacy JWT + Better Auth (dual mode) | Verified |
| Entitlements | Platform plan snapshot + `` | Implemented |
| Frontend Admin | Next.js 16 + Shadcn + TanStack Query | Verified |
| Frontend Store | Next.js 16 | Verified |
| Obfuscation | javascript-obfuscator (production backend only) | Implemented (Unverified) |

## Architecture Principles

1. **Per-Client Deployment** — Each client gets its own Docker stack. No multi-tenant DB.
2. **Entitlement-Gated Features** — Admin features are gated by the tenant plan snapshot from the platform registry.
3. **Single Gateway Rule** — StockService is the single gateway for all stock operations.
4. **Double-Entry Ledger** — ManagedStockLedger is the authoritative stock history log.
5. **Dual Auth** — Legacy JWT and Better Auth coexist during migration.
6. **Server Components Preferred** — Storefront uses Next.js Server Components for reads, minimal client interactivity.

## Deployment Architecture

[To be expanded — references `docs/portainer-deployment.md`]