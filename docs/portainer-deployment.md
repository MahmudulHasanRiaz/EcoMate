# Deployment Runbook — EcoMate SaaS

> **Source of truth (Phase 8).** Replaces the old per-client deployment flow:
> **CI builds images → GHCR; Portainer only pulls.** The per-client model
> (one stack per client, EcoMate-Web repo, `deploy-client.yml`) is archived —
> the SaaS product is ONE stack serving all tenants from the EcoMate repo,
> branch `feat/saas-multitenant` (until it merges to `main`).
> Point-in-time release notes under `docs/superpowers/reports/` are history —
> this file is the live procedure.

## 1. How deployment works

```
GitHub (manual dispatch)                    VPS (Portainer 2.45, CE)
─────────────────────────                    ────────────────────────
ci.yml ──► Build Images ──► GHCR              Deploy SaaS ──► webhook ──►
(all | backend | storefront |                  Portainer stack pulls
 admin | pos | platform-api |                  images + redeploys
 platform-admin | landing |
 caddy, self-hosted
 or github runner)
```

- **Nothing runs on push.** Every workflow is `workflow_dispatch` (manual).
- **CI never deploys.** `ci.yml` only gates (migration-safety, unit tests,
  `caddy validate`) and pushes `latest` + short-sha tags to GHCR.
- **Deploy = webhook trigger.** `deploy-saas.yml` (always `ubuntu-latest`,
  requires `confirm: true`, repo variable `SAAS_DEPLOY_ENABLED=true`, and the
  `SAAS_PORTAINER_WEBHOOK` secret) POSTs the stack's Portainer webhook.
  HTTP 2xx means **trigger accepted, NOT a healthy deploy** — always confirm
  the stack in Portainer UI.
- Images are `linux/amd64` (`platform: linux/amd64` in compose). The VPS is
  amd64; the self-hosted Mac runner builds via emulation (slow — prefer the
  `github` runner for speed).
- **Migrations run automatically in the containers:** platform-api's
  `startup.sh` creates `ecomate_platform` if needed, then runs
  `prisma migrate deploy` (platform migrations first, per master plan §10.3);
  the backend's `startup.sh` self-heals failed migrations, then runs its own
  `migrate deploy`. No manual migration step on deploy.
- **Staging and production are two Portainer stacks from the same compose
  file + same images**, differing only in stack env (§5). Do NOT fork the
  compose file.

## 2. Repo map

| File | Role |
|---|---|
| `docker-compose.yml` | The stack file. 11 services (postgres, redis, backend, storefront, admin, pos, media-static, platform-api, platform-admin, landing, caddy) from GHCR, all env-driven. |
| `portainer/portainer-stack.json` | Portainer custom-template defaults (full SaaS env list). |
| `portainer/Caddyfile` | The edge config (single source of truth, baked into the caddy image). |
| `.env.example` | Every stack env var with docs. Copy → fill → paste into the stack. |
| `.github/workflows/ci.yml` | Manual builds: `runner` (self-hosted/github) + `all` or per-service ticks. |
| `.github/workflows/build-service-image.yml` | Shared builder (buildx, GHA layer cache per service, push to GHCR). |
| `.github/workflows/deploy-saas.yml` | Manual deploys: `confirm` → POST the Portainer webhook. Runs on GitHub runners, never the Mac. |
| `.github/workflows/build-mobile.yml` | Manual mobile builds. |
| `apps/backend/scripts/resolve-failed-migrations.sh` | Self-healing pre-flight for backend `migrate deploy` (P3009/P3018/P2039). |
| `apps/platform-api/startup.sh` | Platform DB create + `migrate deploy` + optional seed, then start. |
| `scripts/backup-db.sh` | Manual backup of BOTH databases (tenant + platform). |
| `scripts/deploy.sh` | Manual/local compose-stack helper (pull + up + health checks). NOT the Portainer path. |

## 3. New stack setup (staging first, end-to-end)

1. **GitHub secret:** repo → Settings → Secrets → Actions → add
   `SAAS_PORTAINER_WEBHOOK` (value = the stack's webhook URL from step 4).
   Also set the repo variable `SAAS_DEPLOY_ENABLED=true` (Settings →
   Variables → Actions) or `deploy-saas.yml` refuses to run.
2. **Portainer stack (Repository method):**
   - GitOps **Source** must exist and validate (Portainer ≥2.43 requires a
     registered source for git stacks; Sources view shows health).
   - **Repository URL must be `https://github.com/MahmudulHasanRiaz/EcoMate`**
     — the EcoMate-Web repo is the archived single-tenant product and has no
     SaaS stack.
   - Ref `refs/heads/feat/saas-multitenant` (until the branch merges to
     `main`), compose path `docker-compose.yml`.
   - Env vars from `.env.example` / `portainer-stack.json` (JWTs,
     `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, platform secrets,
     `PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD`, `SAAS_*` domains,
     SMTP/Turnstile keys). Set `RUN_SEED=true` and
     `RUN_PLATFORM_SEED=true` ONLY for the first deploy, then flip both
     back to `false`.
   - GHCR images are private by default → add a GHCR registry (PAT with
     `read:packages`) in Portainer, or pulls fail with auth errors.
   - **Caddy needs host ports 80/443.** If a per-client stack or another
     service already binds them on the VPS, the caddy service fails to
     start — confirm what occupies 80/443 before creating the stack.
3. **First deploy in the UI until green.** The stack folder
   (`/data/compose/<id>/`) only populates on a successful first deploy.
   Webhook/manual "pull" before that fails with the missing-file error.
   Only after green: copy the stack webhook URL → step 1 secret → dispatch.
4. **Volumes are per stack** (`postgres-data`, `uploads-data`, `backup-data`,
   `license-data`, `platform-exports-data`, `caddy-data`, …). Deleting a
   stack keeps volumes unless explicitly removed — same-name recreates
   reattach data. **Never delete `license-data`** (historic name; now
   mounted at `/app/app-data`): the app encryption key for attendance and
   marketing tokens becomes permanently unreadable without it.
   **Never attach the SaaS stack to an existing per-client volume:** the
   tenant schema was squashed to 2 migrations and `migrate deploy` collides
   with legacy migration history. The SaaS stack always starts on FRESH
   volumes.
5. **Build-time vars are NOT stack env.** `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
   (landing) and `VITE_PLATFORM_API_URL` (platform-admin) are baked into
   their images by CI at build time — setting them in Portainer does
   nothing. `VITE_PLATFORM_API_URL` defaults to empty (same-origin `/api`,
   which Caddy routes); set the Turnstile site key as a CI build arg when
   the landing image is built for production.

## 4. Deploy order (production)

```
1. Backup (both DBs)  →  2. dispatch ci.yml (build)  →  3. dispatch Deploy SaaS  →  4. verify in Portainer
```

```bash
# 1. Backup (MANDATORY — both databases)
bash scripts/backup-db.sh
# ...or the custom-format equivalent:
pg_dump -Fc "$PROD_TENANT_DATABASE_URL" -f tenant_$(date +%Y%m%d_%H%M%S).dump
pg_dump -Fc "$PROD_PLATFORM_DATABASE_URL" -f platform_$(date +%Y%m%d_%H%M%S).dump

# 2. Build: Actions → Build Images → tick what changed (or all)
#    (guards + unit tests + caddy validate run first; images push to GHCR)

# 3. Dispatch: Actions → Deploy SaaS → confirm: true
#    (migrations run automatically in the containers on boot)

# 4. Verify: Portainer stack green, /api/health OK on backend (4000) +
#    platform-api (4100), GHCR tags updated, §7 checklist green
```

Rollback = redeploy the previous image tag via the Portainer UI (webhook
re-trigger with the previous short-sha tag) — migrations here are additive,
so rolling the images back does not need a DB rollback. Rollback is manual
and must be tested on staging before it is ever needed in production.

## 5. Staging vs production (same compose, different env)

| Var / aspect | Staging | Production |
|---|---|---|
| `SAAS_PRIMARY_DOMAIN` | staging domain (e.g. `staging.ecomate.bd` — Boss decision) | `ecomate.bd` |
| `PLATFORM_LANDING_HOST` / `PLATFORM_ADMIN_HOST` / `PLATFORM_API_HOST` | derived from the staging domain | `www` / `saas` / `api.ecomate.bd` |
| Secrets (JWTs, `INTERNAL_SERVICE_SECRET`, `POSTGRES_PASSWORD`, …) | distinct staging values | distinct production values — NEVER copy staging secrets to prod or vice versa |
| `RUN_SEED` / `RUN_PLATFORM_SEED` | `true` on first deploy, then `false` | `true` on first deploy, then `false` |
| `ALLOW_SCALE_SEED` | `1` allowed (scale-test seeder) | NEVER set |
| `DEFAULT_PLAN_VERSION_ID` | staging plan version | production plan version (explicit before launch) |
| Volumes | separate stack volumes (automatic per stack) | separate stack volumes |
| `SAAS_PRIMARY_UNHEALTHY` | `false` unless testing fallback | `false` unless in a real outage |

The real cross-environment risk is copy-pasted env: a staging stack pointed
at production data (or prod secrets pasted into staging). Volumes are
separate automatically; env is the operator's responsibility — diff the two
stacks' env lists before every production deploy.

## 6. Secrets inventory

| Where | What |
|---|---|
| GitHub Actions secrets | `SAAS_PORTAINER_WEBHOOK` (deploy trigger only). |
| GitHub repo variables | `SAAS_DEPLOY_ENABLED=true` (deploy guard). |
| Portainer stack env | DB/JWT/auth/app URLs/ports/pixels + all `PLATFORM_*`, `BILLING_*`, SMTP, Turnstile (see `.env.example`). |
| Portainer registries | GHCR credentials for private image pulls. |
| Portainer GitOps source | Git credentials for the repo (private repo ⇒ required). |

Generate secrets with `openssl rand -hex 64` (JWTs, `INTERNAL_SERVICE_SECRET`,
`TLS_ASK_TOKEN`) and `openssl rand -hex 32` (`APP_ENCRYPTION_KEY`, 64 hex
chars). Every secret gets a DISTINCT value — never reuse one secret for two
purposes.

## 7. First-deploy / post-deploy checklist

Run through this after the first staging deploy, and abbreviated (health +
login + one signup) after every production deploy:

- [ ] `GET /api/health` on platform-api (4100, via `docker compose exec` or
      `https://api.<domain>/api/health`) returns `status: ok`
- [ ] `GET /api/health` on backend (4000) returns OK
- [ ] `GET /api/public/plans` returns the seeded trial plan
- [ ] Platform console login works with the seeded superadmin
      (`https://saas.<domain>`)
- [ ] Landing signup creates a tenant end to end
      (`https://www.<domain>/signup` → verify → provision → tenant admin login)
- [ ] `{slug}.<primary-domain>` serves the tenant storefront over HTTPS
      (on-demand TLS cert issued; check the cert, not just the page)
- [ ] Custom-domain ask endpoint denies an unknown host (no cert issued)
- [ ] `docker compose logs caddy` shows no ACME errors

Local checks without DNS (VM/validation): `curl --resolve` maps a host to
the stack without touching `/etc/hosts`:

```bash
curl -k --resolve www.ecomate.bd:443:127.0.0.1 https://www.ecomate.bd/
curl -k --resolve shop1.ecomate.bd:443:127.0.0.1 https://shop1.ecomate.bd/
```

## 8. Troubleshooting (seen in production)

| Symptom | Cause → fix |
|---|---|
| `Cannot connect to the Docker daemon` (build) | Docker Desktop stopped on the Mac → start it; enable "Start at login". Or dispatch with `runner: github`. |
| `open /data/compose/<id>/docker-compose.yml: no such file` + `Unable to retrieve stack file` | Stack dir never populated: wrong repo URL (EcoMate-Web vs EcoMate), first deploy never green, or webhook fired before first deploy → §3. |
| Webhook returns 204 but stack broken | 204 = trigger accepted only. Check the stack, not the workflow log. |
| `Re-pull image` / `Force redeployment` missing | Business-Edition features (locked on CE). CE path: fix source → recreate → deploy green. |
| Build 15–20 min on github (was ~5) | Docker layer cache miss after lockfile changes (one-time) + ~300 MB Playwright download (now cached) + `all=true` running everything. Tick only needed services. Self-hosted 1h+ is QEMU amd64 emulation — expected. |
| `migrate deploy` P3009 (failed row) | Backend: `resolve-failed-migrations.sh` probe rule: DDL landed → `--applied`, else `--rolled-back`. Never `migrate reset` / `db push`. Platform: check `apps/platform-api/prisma/migrations` history the same way. |
| Portainer shows old code after green deploy | `pull_policy: always` is set — check the stack actually redeployed (webhook 204 ≠ proof) and the image tag moved in GHCR. |
| Caddy fails to start: port 80/443 in use | Another stack/service binds 80/443 on the VPS → §3 step 2. Only the SaaS caddy may own those ports. |
| No cert for a tenant host | Ask endpoint denied it: host not a TenantDomain, CUSTOM not VERIFIED, or tenant DELETED. Check `TLS_ASK_TOKEN` matches on both sides (caddy env vs platform-api env/`INTERNAL_SERVICE_SECRET` fallback). |
| No cert for www/saas/api hosts | These use plain automatic TLS (no ask gate) — check DNS points at the VPS and ports 80/443 are reachable from the internet; read `docker compose logs caddy` for the ACME error. |
| Platform signup fails closed | `TURNSTILE_SECRET_KEY` and SMTP must both be set in production (captcha + verification mail fail closed without them). |
| Backend has no tenant registry | `PLATFORM_API_URL` + `INTERNAL_SERVICE_SECRET` must both reach the backend (compose wires them; check the stack env actually sets the secret). |
