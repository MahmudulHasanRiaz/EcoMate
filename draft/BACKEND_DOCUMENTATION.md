# Backend Guide (Express-Friendly)

> The app runs on Next.js today, but core business logic is organized so you can drop it into an Express/Nest API with minimal churn.

## Layout & Separation
- **Server modules**: `src/server/modules/*` (purchases, products, inventory, staff, staff-auth, integrations, etc.). These are framework-agnostic async functions.
- **Next server actions**: Thin wrappers that import from `@server/modules/*` (alias set in `tsconfig.json`).
- **API routes**: `src/app/api/*` provide REST-ish endpoints (staff CRUD, invite, business settings, Clerk webhook, etc.). Easy to port to Express controllers.
- **Prisma client**: `@/lib/prisma`, schema in `prisma/schema.prisma`.
- **Revalidation helper**: `src/server/utils/revalidate.ts` (no-op outside Next).

## Key Live Endpoints (Next)
- Staff CRUD: `/api/staff` (GET/POST), `/api/staff/:id` (PUT/DELETE), `/api/staff/:id/payments` (POST).
- Staff invite: `/api/staff/invite` → Clerk invitation + DB invite record.
- Clerk webhook: `/api/webhooks/clerk` (Svix verified) handles user.created/updated/deleted → syncs `StaffMember` (role, permissions, phone, business access, pay metadata).
- Business settings: `/api/settings/business` CRUD.
- Misc: product slug validate, Woo integration create, etc.

## Auth / Identity
- Clerk is the source of truth. User metadata (role, permissions, accessibleBusinessIds, phone, payment config) travels via Clerk publicMetadata in invite + webhook.
- Webhook verification uses `CLERK_WEBHOOK_SECRET` (Svix). Set Clerk webhook URL to `http://localhost:9002/api/webhooks/clerk` in dev.

## Env (dev)
```
APP_URL=http://localhost:9002
NEXT_PUBLIC_APP_URL=http://localhost:9002
NEXT_PUBLIC_API_URL=http://localhost:9002
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
CLERK_WEBHOOK_SECRET=...
DATABASE_URL=postgres://...
# Optional
REVALIDATION_TOKEN=dev-revalidate-token
NEXT_PUBLIC_MIM_SMS_USERNAME=...
NEXT_PUBLIC_MIM_SMS_API_KEY=...
NEXT_PUBLIC_MIM_SMS_SENDER_NAME=...
```

## Local Run
```bash
npm install
npx prisma generate
npx prisma db seed    # seeds businesses, staff (with phone), categories, locations
npm run dev           # port 9002
```

## Porting to Express
1) Import from `src/server/modules/*` inside Express route handlers; keep Prisma client import from `@/lib/prisma`.
2) Recreate needed routes: staff CRUD, invite, business CRUD, purchases, etc. by calling module functions.
3) Reuse Clerk webhook handler logic (Svix verify) in Express middleware.
4) Swap `revalidateTags` with your cache invalidation if not on Next.

## Data Model Highlights
- Prisma enums/models in `prisma/schema.prisma` (products, variants, orders, purchases, inventory, staff with phone unique, payments, attendance, accounting, Woo integration, etc.).
- `StaffMember.phone` is required/unique; invite/Clerk/webhook flows expect it.

## Caching / Revalidate
- Next fetch tags can be invalidated via `/api/revalidate?tag=...&secret=REVALIDATION_TOKEN`. In Express, call the same endpoint or implement your own cache busting.

## What’s already Express-ready
- Business logic is isolated in `src/server/modules`.
- API handlers are thin wrappers—use them as reference when recreating Express controllers.
- Auth metadata flows through Clerk webhook + publicMetadata; no frontend secrets needed.
