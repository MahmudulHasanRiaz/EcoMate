# Platform API

The SaaS control plane. It owns the **`ecomate_platform`** database and never connects to the tenant database (`ecomate`).

## Responsibilities

- Tenant registry, domains and status transitions
- Dynamic plans, plan versions, features and limits
- Subscriptions, invoices, manual payments and proof review
- Usage, audit and platform users
- Internal signed APIs consumed by the tenant runtime

## Local development

```bash
# From the repository root
cp apps/platform-api/.env.example apps/platform-api/.env
# Set PLATFORM_DATABASE_URL to a Postgres database, then:
npm run platform:generate
npm run platform:migrate
npm run platform:dev
```

The service listens on `PLATFORM_PORT` (default `4100`).

## Baseline migration

`prisma/migrations/0001_platform_baseline` creates the platform tables. Run `prisma migrate deploy` against `ecomate_platform`; do not point it at the tenant database.

## Current endpoints (Phase 1 foundation)

- `GET /api/health` — service + database health
- `GET /api/public/plans` — public pricing feed (active, public plans with their latest version)

Platform auth, tenant CRUD, plan editing and billing endpoints are the next Phase 1 increments.
