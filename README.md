# EcoMate SaaS

Production-grade SaaS e-commerce platform with admin panel, storefront, and API — monorepo architecture. The current `main` is the single-tenant EcoMate-Web baseline; the multi-tenant SaaS conversion is in progress on `feat/saas-multitenant`.

## SaaS conversion status

- **Initial scope:** convert the current `main` codebase to shared-schema multi-tenancy (`tenant_id` + PostgreSQL RLS).
- **Platform control plane:** `apps/platform-api` + `apps/platform-admin` + `apps/landing` are being added.
- **Plans/entitlements:** dynamic plans replace the KeyMate/Keygen license server.
- **Domain:** primary `ecomate.bd`; configurable base-domain aliases + fallback domain.
- **Central commerce:** deferred until the upstream `feat/central-commerce` branch is finished; it will be ported later with tenantId/RLS from its first migration.
- **Docs:** `SAAS.md`, `docs/2-ARCHITECTURE/ADR/007-shared-schema-multi-tenancy.md`, and `docs/Commandcode/EcoMate SaaS — Multi-Tenant Conversion Plan`.

## Domain configuration

Primary `ecomate.bd`; tenant subdomains are `{slug}.ecomate.bd`. Additional base domains can be added at runtime, and a separate fallback domain can be configured. See `SAAS.md` and `.env.example` for `SAAS_PRIMARY_DOMAIN`, `SAAS_BASE_DOMAINS`, and `SAAS_FALLBACK_DOMAIN`.

## Architecture

```
EcoMate Web/
├── apps/
│   ├── admin/          React 19 SPA — Dashboard, orders, products, CRM, HR/accounting
│   ├── backend/        NestJS 11 (Fastify) — REST API, Prisma 7 + PostgreSQL 16
│   ├── pos/            React 19 SPA — Point of Sale (PWA, offline-capable)
│   ├── storefront/     Next.js 16 — Public storefront, landing pages, checkout
│   ├── platform-api/   NestJS — SaaS control plane (planned, Phase 1)
│   ├── platform-admin/ React SPA — SaaS admin (planned, Phase 1)
│   └── landing/        Next.js — SaaS marketing/signup (planned, Phase 1)
├── packages/
│   ├── feature-flags/  NestJS module — runtime feature gating via license entitlements
│   ├── license-engine/ License validation client — KeyMate API + 7-day local cache
│   └── shared-types/   Shared TypeScript definitions across workspaces
├── docker-compose.yml  6 services (postgres, redis, backend, storefront, admin, pos)
├── portainer/          Portainer stack config + self-hosted Keygen CE license server
├── scripts/            Utility scripts — dev wait-for-backend, DB backup, deploy helper
├── docs/               Feature specs, deployment guides, superpowers design docs
└── .github/workflows/  CI (lint/test/build) + CD (Docker build/push + Portainer deploy)
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Monorepo** | npm workspaces (no Turborepo) |
| **Backend** | NestJS 11 + Fastify, TypeScript (strict) |
| **Admin** | React 19, Vite 6, TanStack Router, TanStack Query, TanStack Table |
| **Storefront** | Next.js 16 (App Router, standalone output) |
| **Database** | PostgreSQL 16 + Prisma 7 ORM |
| **Cache/Queue** | Redis 7 + BullMQ |
| **Auth** | better-auth + Passport (JWT), bcryptjs |
| **Admin UI** | shadcn/ui (Radix primitives), Tailwind CSS v4, Recharts, TipTap editor |
| **Storefront UI** | Tailwind CSS v4, Motion (Framer Motion), Lucide icons |
| **Validation** | Zod, class-validator, class-transformer |
| **Testing** | Vitest (admin/storefront), Jest (backend), Playwright (browser tests) |
| **CI/CD** | GitHub Actions → ghcr.io → Portainer webhook |
| **Containerization** | Docker (3-stage backend with JS obfuscation, 2-stage storefront & admin) |
| **Reverse Proxy** | Traefik (VPS) or Nginx (admin Docker image) |
| **Email** | Nodemailer |
| **File Storage** | AWS S3 + local uploads via sharp |
| **Licensing** | SaaS entitlements from the platform control plane (KeyMate/Keygen being removed) |
| **Security** | Helmet (Fastify), rate limiting, JS obfuscation, CSP headers, account lockout |

## Applications

### `apps/backend` — NestJS REST API

Fastify-based API at port 4000. Key modules:

- **Auth** — better-auth (email/password, social login), JWT refresh tokens, failed attempt lockout, RBAC
- **Catalog** — Products, variants, categories, brands, inventory, purchasing, GRN, size charts, attributes, tags, combos
- **Stock** — Stock routing engine (`StockRouterService`), costing lot consumption (FIFO), `InventoryEnabledGuard` for MANAGED_STOCK products
- **Inventory** — Stock adjustments, movement ledger, physical inventory counts with ledger tracking, warehouse-level partial unique indexes
- **Warehouses** — Hierarchical structure: zones → racks → shelves (bin locations), hierarchy management DTOs
- **Dispatch** — Dedicated dispatch module: controller, service, DTOs for fulfillment workflows
- **Orders** — Checkout, payments, order lifecycle, shipping (Steadfast, Pathao, Redx, Carrybee), refunds, packing, shipment tracking
- **CRM** — Customers, leads, referrals, email campaigns, notification templates, reviews; auto-creates CustomerProfile during registration & checkout
- **POS** — Point of Sale endpoints, offline sync support
- **Finance** — Chart of Accounts, double-entry journal entries, financial periods, expense management, opening balances
- **HR** — Employee management, payroll, attendance
- **CMS** — Pages, landing pages (template + custom HTML), media gallery
- **Tracking** — Server-side event tracking: Meta Conversions API (CAPI), TikTok Events API, GA4 Measurement Protocol, Google Ads offline conversions. BullMQ queue-backed with page view buffering
- **Operations** — Warehouses, suppliers, delivery areas, coupons, tasks
- **License (legacy)** — KeyMate activation to be removed in the SaaS conversion; encryption utilities retained as `APP_ENCRYPTION_KEY`
- **Security** — IP/phone blocking system, throttling, Helmet CSP
- **Platform** — Search, import/export, product feed (Google/Meta), queue management, cache, image processing, uploads, system settings

### `apps/admin` — React SPA Dashboard

Served at `/admin/` base path. Features:

- Dashboard with realtime charts (Recharts)
- Product/order/customer CRUD with TanStack Table (sort, filter, pagination)
- Landing page builder with TipTap editor
- Media gallery with upload, crop, compress
- Warehouse hierarchy management (zones, racks, shelves)
- Physical stock adjustment dialogs with multi-item & variant support
- Tag input component with search + create functionality
- Employee/HR management + payroll
- Accounting module (double-entry bookkeeping)
- Settings: store config, shipping zones, tax rates, email templates, tracking pixels
- RBAC-based access control
- License activation page (first-run setup)

### `apps/pos` — React 19 SPA Point of Sale

PWA with offline support via service worker + IndexedDB. Features:

- Barcode/QR scanner for quick product lookup
- Offline mode with local queue, auto-sync on reconnect
- Cash, card, mobile banking payment handling
- Receipt printing (Bluetooth thermal printer)
- Customer display (dual-screen support)
- Order holds, splits, and discounts
- Shift management with cash-in/cash-out logging

### `apps/storefront` — Next.js 16 Public Site

- Product browsing, search, filtering
- Cart + checkout flow with shipping address normalization & CustomerProfile auto-creation
- Landing pages (template + custom HTML modes)
- ISR with 300s revalidation
- Product description HTML sanitization (isomorphic-dompurify)
- Dynamic PWA manifest generation (`manifest.ts`)
- Testimonials carousel
- Brand logo component
- Commerce thank-you page customizable section
- Tracking pixel integration (Meta, TikTok, GA4, Google Ads)
- Dev-mode rewrites admin to local Vite dev server
- Security headers, image optimization, standalone Docker output

## Packages

| Package | Description |
|---------|-------------|
| `@ecomate/license-engine` | **Legacy** — KeyMate license validation; removed when SaaS entitlements land. |
| `@ecomate/feature-flags` | NestJS module for runtime feature gating; being re-pointed at SaaS entitlements. |
| `@ecomate/shared-types` | Shared TypeScript interfaces and types used across apps. |

## Quick Start (Development)

```bash
# 1. Install dependencies (root monorepo)
npm install

# 2. Copy env files
cp apps/backend/.env.example apps/backend/.env
cp apps/storefront/.env.example apps/storefront/.env
cp apps/admin/.env.example apps/admin/.env
cp apps/pos/.env.example apps/pos/.env

# 3. Start PostgreSQL + Redis (Docker)
docker compose up -d postgres redis

# 4. Run DB migrations
npm run backend:migrate

# 5. Start all dev servers (or individually)
npm run dev

# Individual servers:
npm run backend:dev    # http://localhost:4000
npm run admin:dev      # http://localhost:5173
npm run storefront:dev # http://localhost:3000
npm run pos:dev        # http://localhost:5174
```

### Dev Bypass (No License Required)

```bash
# Set in apps/backend/.env:
DEV_LICENSE_BYPASS=true
```
Only works when `NODE_ENV !== production`. Bypasses all license checks for local dev.

## Testing

```bash
# Backend (Jest)
cd apps/backend && npx jest

# Admin (Vitest)
cd apps/admin && npx vitest run

# Storefront (Vitest)
cd apps/storefront && npx vitest run

# Full CI pipeline (simulates GitHub Actions)
cd apps/backend && npx jest
cd apps/admin && npx vitest run && npm run build:skip-tsc
cd apps/storefront && npx vitest run && npm run build
```

## Deployment

### CI/CD Pipeline (GitHub Actions)

Push to `main` or `develop` (and PRs to `main`) triggers automated build + push to ghcr.io:

1. **detect-changes** — determines which apps changed
2. **backend** — lint, test (with postgres service container)
3. **storefront** — lint, test, build
4. **admin** — lint, test, build:skip-tsc
5. **build-push-*** — Docker build + push to `ghcr.io/mahmudulhasanriaz/ecomate-{backend,storefront,admin}`

### Docker Compose (VPS + Portainer)

```bash
# Set environment variables in Portainer stack
# Deploy docker-compose.yml with ghcr.io images
# Portainer auto-redeploys via webhook after CI
```

**Migrations run automatically** on each container start via `apps/backend/startup.sh`:
1. `prisma migrate deploy` runs before server starts
2. Built-in retry loop (5 attempts) handles transient failures
3. Auto-resolves `P3018` (DB objects exist — marks migration as applied)
4. Auto-rolls back `P3009` (failed migration) and retries

**Zero-data-loss migrations:** All cumulative migrations use `IF NOT EXISTS` / `IF EXISTS` guards. No `DROP COLUMN` or `DROP TABLE` in production migrations. See `apps/backend/prisma/migrations/20260707100000_production_safe_cumulative/migration.sql`.

### Per-Client Deployment

```bash
# Legacy single-tenant workflow; the SaaS repo uses .github/workflows/deploy-saas.yml
# Select client + license plan → builds client-tagged images → triggers Portainer webhook
```

### Environment Variables

Key variables for production (set in Portainer stack):

| Variable | Description |
|----------|-------------|
| `CLIENT_DOMAIN` | Client domain (e.g., example.com) |
| `JWT_SECRET` | `openssl rand -hex 64` |
| `JWT_REFRESH_SECRET` | Different from JWT_SECRET |
| `POSTGRES_PASSWORD` | DB password |
| `LICENSE_ENCRYPTION_KEY` | `openssl rand -hex 32` (AES-256-GCM) |
| `KEYMATE_API_URL` | KeyMate license server URL |
| `REDIS_PASSWORD` | Redis password |
| `CORS_ORIGIN` | Comma-separated allowed origins |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` (better-auth) |
| `BETTER_AUTH_URL` | Public-facing API URL (e.g., https://api.example.com) |
| `META_PIXEL_ID`, `META_ACCESS_TOKEN` | Meta Pixel + Conversions API |
| `TIKTOK_PIXEL_CODE`, `TIKTOK_ACCESS_TOKEN` | TikTok Pixel + Events API |
| `GA_MEASUREMENT_ID`, `GA_API_SECRET` | GA4 Measurement Protocol |
| `GA_ADS_CONVERSION_ID`, `GA_ADS_CONVERSION_LABEL` | Google Ads offline conversions |

Full list: `apps/backend/.env.example` and root `.env.example`.

## Database

- **ORM:** Prisma 7
- **Schema:** `apps/backend/prisma/schema.prisma` (~1720 lines, 86+ models)
- **Migrations:** 40+ migrations
- **Hard rule:** Every `schema.prisma` change REQUIRES a migration file. `db push --accept-data-loss` is FORBIDDEN.
- **Hard rule:** Production migrations must be fully idempotent — every statement guarded by `IF NOT EXISTS` / `IF EXISTS`. No `DROP COLUMN`, no `DROP TABLE`.

```bash
# Create migration
cd apps/backend && npx prisma migrate dev --name <description>

# Apply in production (auto-run in Docker container on start)
npx prisma migrate deploy

# Generate client
npx prisma generate
```

## License Activation

- License credentials stored encrypted in DB (AES-256-GCM), not env vars
- Activation via UI at `/license/activate` after sign-in
- Domain auto-detected from `Host` header
- 7-day offline cache after initial activation
- Requires KeyMate reachable for first activation (no grace period)
- Production Docker images set `NODE_ENV=production` — license is mandatory

API reference: `POST /api/license/activate` — `{ licenseKey, apiKey? }`

## Obfuscation

Backend Docker build applies `javascript-obfuscator` (control flow flattening, string array encoding, dead code injection, self-defending). Config: `apps/backend/obfuscator.config.json`.

## Docs

| File | Contents |
|------|----------|
| `docs/keygen-setup.md` | Self-hosted Keygen CE license server deployment |
| `docs/landing-page-builder.md` | Landing/sales page builder technical spec |
| `docs/portainer-deployment.md` | VPS + Portainer deployment guide |
| `docs/Marketing Attribution.md` | Marketing attribution platform spec (Meta Ads integration, profit intelligence) |
| `docs/1-BUSINESS/` | Business domain contract, architecture invariants, feature registry |
| `docs/superpowers/` | Feature plans and design specs (accounting, HR, catalog, license activation UI, etc.) |
| `AGENT.md` | AI agent behavior rules and project conventions |
| `apps/backend/.env.example` | Backend environment variables |
| `portainer/keygen/.env.example` | Keygen license server environment |
| `scripts/backup-db.sh` | Database backup script |
| `scripts/deploy.sh` | Deployment helper |
| `scripts/wait-for-backend.js` | Dev-server readiness waiter |

## Project Conventions

- **TypeScript strict mode** across all workspaces
- **npm workspaces** monorepo (no Turborepo)
- **Shared types** in `packages/shared-types/`
- **Strict app boundaries** — no direct imports between apps
- **API-first** — core commerce should not depend on realtime
- **Migration safety** — every schema change gets a migration file; production migrations must be idempotent (all `IF NOT EXISTS`), zero destructive ops
- **Tests required** for critical flows (checkout, payment, inventory, orders, auth, RBAC, refunds)
- **JS obfuscation** applied to backend production builds only

## Multi-Tenancy

The SaaS product uses **shared-schema multi-tenancy**: one PostgreSQL database, `tenant_id` on every tenant table, and PostgreSQL Row-Level Security. The platform control plane owns tenants, plans, subscriptions and domains; the archived single-tenant product used one Docker stack per client.

1. One shared tenant database, isolated by `tenant_id` + RLS.
2. One platform control plane (`ecomate_platform`) for tenants, plans, billing and domains.
3. Feature entitlements come from the plan, not from a KeyMate license.
4. Tenant hosts are `{slug}.ecomate.bd` plus optional base-domain aliases and custom domains.
5. SaaS images are tagged `ecomate-saas-*`; the legacy per-client images remain in the archived product.
