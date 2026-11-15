# EcoMate landing (signup)

Public SaaS front door and signup wizard.

```bash
npm run landing:dev   # http://localhost:3002
```

It calls the platform API through a same-origin `/api/*` rewrite
(`PLATFORM_API_URL`, default `http://localhost:4100/api`), so no CORS surface is
exposed.

## Flow

1. `/signup` — store name + address, owner account, review/terms.
2. The platform sends a verification link (`PLATFORM_LANDING_URL` +
   `/verify-email?token=...`).
3. `/verify-email` confirms the token and shows the verified state.

CAPTCHA is Cloudflare Turnstile when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (this app)
and `TURNSTILE_SECRET_KEY` (platform API) are set; local development runs
without it. Rate limits live in the platform API.
