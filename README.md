# Fashionary ERP

Fashionary is a production?ready ERP for fashion businesses built with Next.js (App Router). It covers orders, inventory, purchases, accounting, staff, marketing, integrations, and operational tooling with strong role/permission controls.

## Tech Stack
- Framework: Next.js (App Router)
- Language: TypeScript
- UI: Tailwind CSS + shadcn/ui
- Auth: Clerk (staff invites + roles)
- Data: Prisma + Postgres
- Queues: BullMQ (Redis/Memurai)
- Charts: Recharts

## Core Modules
- Orders: create/update, filters, bulk actions, printing
- Inventory: multi?location stock, lots, movements, adjustments
- Products: variants, combos, categories
- Customers: history, spend, badges
- Purchases: production tracking (fabric/printing/cutting)
- Staff: roles, permissions, payments, attendance, performance
- Finance: expenses, check passing, accounting, ledger, balance sheet
- Marketing: campaigns, spend, attribution, KPIs
- Tasks: assignments, reporting, role?scoped visibility
- Integrations: WooCommerce, courier, SMS/SMTP

## Platform Features
- Cursor pagination across heavy lists
- Async exports (queue + fallback)
- Reporting cache with stampede protection
- Webhook failure tracking + replay
- Background jobs (maintenance, sync, export)
- Rate limiting on heavy endpoints
- Configurable theme and badge rules

## Getting Started (Local)

### Prerequisites
- Node.js 18+
- Postgres 14+
- Redis (recommended). On Windows, Memurai Developer works as a drop?in Redis.

### Environment
Create `.env` (or update existing) with:
```
APP_URL=http://localhost:9002
NEXT_PUBLIC_APP_URL=http://localhost:9002
NEXT_PUBLIC_API_URL=http://localhost:9002
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
CLERK_WEBHOOK_SECRET=svix_...
DATABASE_URL=postgres://...
REDIS_URL=redis://127.0.0.1:6379   # optional but recommended
```

### Install + Prisma
```
npm install
npx prisma generate
npx prisma migrate deploy
```

### Dev Server
```
npm run dev
```
App runs on http://localhost:9002

### Worker (BullMQ)
```
npm run worker
```
The worker processes exports, sync batches, and background jobs.

### Clerk Webhook (Dev)
Set Clerk webhook URL to:
```
http://localhost:9002/api/webhooks/clerk
```
Events: user.created, user.updated, user.deleted
Secret: `CLERK_WEBHOOK_SECRET`

## Settings
- General: store info, timezone, low stock threshold, theme
- Badges: /dashboard/settings/badges (customer + staff rules)
- Integrations: WooCommerce, courier
- Notifications: SMS/Email templates

## Useful Scripts
- `npm run dev` ? dev server
- `npm run build` ? production build
- `npm run worker` ? BullMQ worker
- `npx prisma generate` ? Prisma client

## Project Structure
- `src/app/api/*` ? API routes
- `src/app/dashboard/*` ? ERP UI pages
- `src/server/modules/*` ? domain logic
- `src/services/*` ? client data fetchers
- `src/lib/*` ? shared utilities, permissions, Prisma client
- `src/types/*` ? shared types
- `scripts/*` ? ops scripts and workers

## Notes
- Redis is optional for dev, but recommended for queues and caching.
- The app enforces role?based access across modules.

---
If you need deployment or operational runbooks, check the draft/ artifacts and runbooks in the repo.
