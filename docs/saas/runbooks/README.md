# EcoMate SaaS — Operator Runbooks

Incident runbooks for the multi-tenant SaaS platform (one stack serving all
tenants from the `EcoMate` repo, branch `feat/saas-multitenant`). Each runbook
is written to be followed during an incident: symptoms first, then diagnosis
commands, then the fix, then how to verify it worked.

**Services** (production hostnames are illustrative; see the Portainer stack
env for the real values):

| Service | Port | Role |
|---|---|---|
| `platform-api` | 4100 (internal) | Control plane: tenants, plans, billing, domains, jobs. Own DB `ecomate_platform`. |
| `backend` | 4000 (internal) | Tenant runtime: shops, orders, RLS-isolated data. DB `ecomate`. |
| `storefront` | 3000 (internal) | Tenant storefronts (Next.js), behind Caddy. |
| `platform-admin` | 5174 (internal) | Operator console (SaaS admin UI). |
| `landing` | 3002 (internal) | Public front door: signup, pricing, terms. |
| `admin` / `pos` | static | Tenant admin SPA / POS, served behind Caddy. |
| `postgres` | 5432 | Both databases (`ecomate`, `ecomate_platform`). |
| `redis` | 6379 | Cache, rate limits, BullMQ queues. |
| `caddy` | 80/443 | Edge: host routing + on-demand TLS. |

**Conventions used in every runbook:**

- `PLATFORM` = platform-api base URL, e.g. `https://api.ecomate.bd/api`
  (from inside the stack: `http://platform-api:4100/api`).
- `BACKEND` = tenant-backend base URL, e.g. `https://api.ecomate.bd/api`
  through Caddy, or `http://backend:4000/api` inside the stack.
- `$TOKEN` = a platform operator access token (SUPERADMIN unless the step
  says BILLING/SUPPORT is enough). Obtain one by logging in to the console
  or via `POST $PLATFORM/auth/login` (SUPERADMIN login requires TOTP MFA).
- `psql` commands run against the platform DB unless they say "tenant DB".
  All timestamps in the platform are UTC; `psql` sessions default to
  Asia/Dhaka on this host — prefix date comparisons with
  `SET TIME ZONE 'UTC';`.
- The backend registry syncs from platform-api every 60 s
  (`TENANT_REGISTRY_REFRESH_MS`); the storefront adds its own 60 s host
  cache. After any tenant status/domain change, **allow up to ~2 minutes**
  for the change to be visible everywhere before concluding the fix failed.
- Billing jobs are in-process on a **single** platform-api instance
  (no cross-instance lock). Never run two platform-api replicas with
  `BILLING_JOBS_ENABLED=true`.

## Runbooks

| # | Runbook | When to use it |
|---|---|---|
| 1 | [Provisioning failure](01-provisioning-failure.md) | Owner stuck on "Preparing your store"; tenant `PROVISIONING`; provisioning job `FAILED`. |
| 2 | [Payment backlog](02-payment-backlog.md) | Proof queue growing; invoices not issued; trials not expiring; `GET /jobs` stale or erroring. |
| 3 | [Tenant suspension](03-tenant-suspension.md) | Tenant reports store/admin down; console shows `SUSPENDED`; disputed or wrongful suspension. |
| 4 | [Custom-domain failure](04-custom-domain-failure.md) | One tenant's custom host NXDOMAIN / cert error / 404 / wrong tenant. |
| 5 | [Domain / fallback outage](05-domain-fallback-outage.md) | Tenant subdomains unreachable platform-wide; health reports `primaryHealthy: false` or `degraded`. |
| 6 | [DB restore](06-db-restore.md) | Data loss/corruption, failed migration, health-check DB ping failing. **Boss-level: restore to a scratch DB first.** |

## Escalation

- **Any cross-tenant data leak** (a tenant seeing another tenant's data):
  treat as a security incident — freeze the affected surface, preserve logs,
  notify Boss immediately. Rollback criteria: any leak = immediate rollback
  of the canary/deployment, no threshold.
- **Any restore** (runbook 6) is Boss-level before it touches production.
- **Mass tenant impact** (all signups failing, all checkouts failing, all
  custom domains down): notify Boss; do not bulk-reactivate or bulk-change
  tenants without approval.
- **Revenue-affecting backlog** (proof queue older than one billing cycle):
  page Boss.

## Related docs

- `SAAS.md` — architecture + the original runbook skeleton (superseded by
  this directory for the six incidents above).
- `docs/saas/phase-7-progress.md` — billing lifecycle semantics (grace,
  suspension, reactivation rules).
- `docs/deployment/client-onboarding-runbook.md` — **OBSOLETE** for SaaS
  (single-tenant per-client model); kept for the still-running per-client
  stacks only.
