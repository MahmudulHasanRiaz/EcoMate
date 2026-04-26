# Manual Deployment (Portainer + Git)

This guide assumes Portainer is already installed on your VPS. We will deploy the project from GitHub, set fixed resources (CPU/RAM/Storage), and keep updates simple.

## 1) Prepare VPS
- Open inbound ports: 80/443 (web), 3000 (optional direct), 6379 (only if Redis must be external; otherwise keep internal).
- Install Docker + Portainer (already done).

## 2) Decide Resources (example)
Adjust based on traffic:
- Web (Next.js): 1?2 vCPU, 2?4 GB RAM
- Worker (BullMQ): 0.5?1 vCPU, 1?2 GB RAM
- Redis: 0.25?0.5 vCPU, 512 MB RAM
- Storage: 20?40 GB minimum (Postgres is external; redis volume is small)

## 3) Create Stack from Git in Portainer
Portainer ? **Stacks** ? **Add stack**
- Name: `fashionary`
- Build method: **Git repository**
- Repository URL: `https://github.com/<org>/<repo>.git`
- Branch: `main` (or your release branch)
- Compose file path: `docker-compose.yml`

### Environment Variables (Stack Env)
Add these in Portainer ?Environment variables?:
```
APP_URL=https://your-domain.com
NEXT_PUBLIC_APP_URL=https://your-domain.com
NEXT_PUBLIC_API_URL=https://your-domain.com
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
CLERK_WEBHOOK_SECRET=svix_...
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB
REDIS_URL=redis://redis:6379
```

> NOTE: `docker-compose.yml` currently uses redis service named `redis`. Keep `REDIS_URL=redis://redis:6379`.

## 4) Set Resource Limits (Portainer UI)
After stack is created:
- Go to **Containers** ? select `fashionary_app` ? **Duplicate/Edit**
- Set:
  - CPU limit (e.g. 1.5)
  - Memory limit (e.g. 3 GB)
- Repeat for `fashionary_redis` (lower limits)

> Portainer sets limits per container. If you want limits stored in compose, add `deploy.resources` blocks.

## 5) Optional: Add a Worker Service
If you want async jobs in a separate container, update compose to include:
```
worker:
  container_name: fashionary_worker
  build:
    context: .
    dockerfile: Dockerfile
  restart: always
  environment:
    - DATABASE_URL=${DATABASE_URL}
    - REDIS_HOST=redis
    - REDIS_PORT=6379
    - NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
  depends_on:
    - redis
  command: npm run worker
```

Then redeploy the stack.

## 6) Domain + SSL
Use a reverse proxy (Nginx or Traefik). Recommended:
- Proxy `https://your-domain.com` ? `fashionary_app:3000`
- Issue SSL via Let?s Encrypt

## 7) Webhooks
Clerk Webhook URL:
```
https://your-domain.com/api/webhooks/clerk
```
Events: `user.created`, `user.updated`, `user.deleted`
Secret: `CLERK_WEBHOOK_SECRET`

WooCommerce webhook is auto?managed by the app.

## 8) Updates (One?Click)
When you push to GitHub:
- Portainer ? Stack ? **Pull and redeploy**
- Or enable Portainer GitOps auto?update (poll or webhook)

Recommended flow:
1. Push code ? GitHub
2. Portainer redeploy
3. Check logs + smoke test

## 9) Health Check Checklist
- App loads
- Login works
- Orders list loads
- Woo sync works
- Worker logs show jobs processing

---
If you want, I can provide a hardened compose file with resource limits, worker service, and healthchecks.
