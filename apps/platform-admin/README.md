# Platform admin frontend (Vite SPA)

`apps/platform-admin` is the SaaS operator console. It talks to
`apps/platform-api` over same-origin `/api` in production; the Vite dev server
proxies `/api` to `PLATFORM_API_PROXY` (default `http://localhost:4100`).

```bash
npm run platform-admin:dev
```

Build with `npm run platform-admin:build`; serve `dist` behind Caddy on the
platform-admin host with an `/api` proxy to platform-api.
