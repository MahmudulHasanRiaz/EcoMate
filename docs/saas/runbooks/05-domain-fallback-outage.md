# Runbook 5 — Domain / fallback outage (primary domain or edge down)

**Severity:** P0 — platform-wide reachability. Notify Boss early; the
fallback-domain flip is a Boss-level decision when the fallback domain is
customer-visible.

## Symptoms

- Tenant subdomains unreachable or serving certificate errors
  platform-wide.
- `GET $PLATFORM/health` reports `primaryHealthy: false` or
  `status: 'degraded'`.
- Caddy failing to issue or renew certificates.

## Background

- The primary domain (`SAAS_PRIMARY_DOMAIN`, e.g. `ecomate.bd`) serves
  tenant subdomains (`<slug>.ecomate.bd`), the platform hosts
  (`www`/`saas`/`api`), and the custom-domain CNAME target.
- A fallback domain (`SAAS_FALLBACK_DOMAIN`) can be configured. When the
  primary is unhealthy, setting `SAAS_PRIMARY_UNHEALTHY=true` (env on
  platform-api **and** storefront, restart both) makes new links and
  alias redirects use the fallback while canonical URLs stay canonical.
  Health reports `degraded` when the primary is unhealthy **and** no
  fallback is configured.
- `primaryHealthy` is a **manual flag, not a probe** — nothing detects a
  primary-domain/TLS outage automatically. An operator must flip it.
  (A real probe is planned; until then, the uptime monitors in the
  canary checklist are the detection path.)
- Tenant resolution itself does not need Caddy (the registry is
  platform-api), but nothing is reachable without the edge.

## Diagnosis

1. **DNS** for the primary and the fallback:

   ```bash
   dig +short ecomate.bd
   dig +short <slug>.ecomate.bd
   dig +short <fallback-domain>
   ```

2. **Health:**

   ```bash
   curl -s "$PLATFORM/health"
   curl -s "$BACKEND/health"
   ```

   Note `primaryHealthy` and `status` (`degraded` = primary unhealthy
   with no fallback configured).

3. **Caddy:** admin/logs for on-demand ask errors and ACME failures.
   Check the ask endpoint directly with a known subdomain:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' \
     "http://platform-api:4100/api/internal/tls/allow?domain=<slug>.ecomate.bd&token=$TLS_ASK_TOKEN"
   ```

   2xx expected for any non-DELETED tenant's subdomain.

4. **Domain config validity:**

   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" "$PLATFORM/domains/config"
   ```

5. **Scope the outage:** is it DNS (NXDOMAIN everywhere), TLS (cert
   errors), Caddy (connection refused/timeout), or platform-api (ask
   endpoint down)? Each has a different fix below.

## Fix

| Cause | Fix |
|---|---|
| Primary domain/DNS down, fallback configured | Set `SAAS_PRIMARY_UNHEALTHY=true` on platform-api + storefront, restart both. New links/redirects use `SAAS_FALLBACK_DOMAIN`; canonical URLs stay canonical. Confirm tenant aliases still resolve. **Boss decision** if the fallback domain is customer-visible. |
| Primary domain/DNS down, no fallback | There is no routing lever — restore DNS/the primary. Health stays `degraded` until then. Do not invent a fallback on the fly (DNS + TLS for a new domain cannot be improvised mid-incident). |
| Caddy down | Restore Caddy (restart the container; check port 80/443 binds — if a per-client stack already binds them, Caddy fails to start). Tenant resolution needs no Caddy, but nothing is reachable without the edge. |
| ACME issuance failing | Check Caddy can reach the ACME endpoint; check the ask endpoint is reachable from Caddy on the private network; check rate limits (Let's Encrypt: 50 certs/week/domain). Existing certs keep serving until expiry — issuance failure is not an instant outage. |
| Ask endpoint denying valid hosts | Check platform-api health + DB; check `TLS_ASK_TOKEN` matches Caddy's config; check the tenant is not `DELETED`. |
| `PlatformSetting.domains` invalid | Fix via `PATCH /domains/config` in the console, then verify with `GET /domains/config`. |

**Never route an unknown host to a tenant:** unknown hosts get a 404 or
the landing page — never a tenant shell. If you are tempted to widen
routing to "restore service", stop and escalate instead.

## Verify

- Tenant subdomains resolve and serve over HTTPS with valid certs.
- `GET $PLATFORM/health` reports `primaryHealthy: true`
  (or `false` with a working fallback and `status` not `degraded`).
- Alias hosts 301 to canonical; `/api` on an alias still answers.
- A custom-domain tenant serves on its custom host (runbook 4 checks).

## Escalation

- DNS-provider or ACME-provider outage: check the provider status page,
  notify Boss. The fallback domain is the business-continuity switch.
- Flipping to the fallback domain when it is customer-visible is a
  Boss-level decision.
- After recovery, unset `SAAS_PRIMARY_UNHEALTHY` (env + restart) only
  once the primary is verified healthy — and confirm canonical URLs
  return to the primary.
