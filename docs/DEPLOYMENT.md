# Deployment Guide (Production)

This guide covers a standard production deployment with Postgres + Redis + BullMQ worker.

## 1) Server Requirements
- Linux VM (Ubuntu 22.04+ recommended)
- Node.js 18+
- Postgres 14+
- Redis 6+ (or managed Redis)
- Nginx (optional, for reverse proxy)

## 2) Environment Variables
Create `.env` in the project root:
```
APP_URL=https://your-domain.com
NEXT_PUBLIC_APP_URL=https://your-domain.com
NEXT_PUBLIC_API_URL=https://your-domain.com
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
CLERK_WEBHOOK_SECRET=svix_...
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB
REDIS_URL=redis://HOST:6379
```

## 3) Install Dependencies
```
npm install
```

## 4) Prisma (Migrations + Client)
```
npx prisma generate
npx prisma migrate deploy
```

## 5) Build
```
npm run build
```

## 6) Start with PM2
Use the provided `ecosystem.config.cjs`:
```
pm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

This will start:
- `ecomate-web` (Next.js)
- `ecomate-worker` (BullMQ worker)

## 7) Webhooks
Set Clerk webhook URL:
```
https://your-domain.com/api/webhooks/clerk
```
Events: user.created, user.updated, user.deleted
Secret: `CLERK_WEBHOOK_SECRET`

## 8) Redis Validation
Check Redis is reachable:
```
redis-cli -u $REDIS_URL ping
```
Expected: `PONG`

## 9) Health Checks
- Open the site in browser
- Confirm login works
- Trigger a small export or Woo sync to validate worker queue

## 10) Notes
- If you use Nginx, proxy to Next.js port and enable HTTPS.
- Keep Redis running to enable queue + caching features.
- For updates: pull code, run prisma migrate deploy, rebuild, then pm2 restart.
