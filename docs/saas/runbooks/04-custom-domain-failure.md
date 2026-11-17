# Runbook 4 — Custom-domain failure (one tenant's domain down)

**Severity:** P1 for the tenant. If **all** custom domains fail at once,
it is a Caddy or platform-api outage — see runbook 5.

## Symptoms

- Tenant's custom host returns NXDOMAIN, a certificate error, a 404, or
  the wrong tenant's shop.
- Console shows the domain `PENDING`, or `VERIFIED` with
  `tlsStatus: 'PENDING'`.

## Background

Custom-domain lifecycle (platform-api `domains` module):

1. Operator/tenant adds the domain (`POST /tenants/:id/domains`) — the
   platform issues a TXT verification token and DNS instructions. The
   domain needs the `custom_domain` plan feature.
2. Verification requires **both**: a TXT record at
   `_ecomate-verify.<host>` equal to the token, **and** a CNAME pointing
   at `SAAS_CUSTOM_DOMAIN_CNAME` (default `cname.ecomate.bd`). A
   background poller re-checks every `CUSTOM_DOMAIN_POLL_MS` (default
   60 s) while `CUSTOM_DOMAIN_POLL_ENABLED` is on.
3. On success the domain becomes `VERIFIED` (+ `tlsStatus: 'PENDING'`)
   and primary (other domains demoted). On failure it stays `PENDING`
   and `verified: false` is returned honestly.
4. Caddy issues certificates on demand, gated by the TLS ask endpoint:
   `GET /internal/tls/allow?domain=<host>&token=...` returns 2xx only
   for subdomain hosts of non-DELETED tenants, and for CUSTOM hosts only
   when `VERIFIED`/`ACTIVE`. Anything else → 404, no certificate.

> **Known limitation:** `tlsStatus` is only ever written as `'PENDING'`
> by the platform (set on verify). Until the TLS-health job lands, do
> **not** use it as a health signal — a `VERIFIED` domain with
> `tlsStatus: 'PENDING'` is normal, not broken. Verify TLS by probing
> the host directly (below).

Routing staleness: after verify/remove, the backend registry poll (60 s)
plus the storefront host cache (60 s) mean up to ~2 minutes before routing
fully reflects the change.

## Diagnosis

1. **Console Domains page:** status, verification token, last-checked time.
2. **DNS** (from any shell):

   ```bash
   dig TXT _ecomate-verify.<host> +short
   dig CNAME <host> +short
   ```

   Expected: the TXT value equals the console token; the CNAME equals
   `SAAS_CUSTOM_DOMAIN_CNAME` (default `cname.ecomate.bd`).
3. **Force a re-check** (audited):

   ```bash
   curl -s -X POST -H "Authorization: Bearer $TOKEN" \
     "$PLATFORM/domains/tenants/<tenant-id>/recheck"
   ```

4. **TLS ask probe** (from inside the stack network — the endpoint is
   internal-only):

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' \
     "http://platform-api:4100/api/internal/tls/allow?domain=<host>&token=$TLS_ASK_TOKEN"
   ```

   2xx = certificate allowed; 404 = the platform will not issue for this
   host (not verified, tenant deleted, or token mismatch).
5. **Registry resolution:**

   ```bash
   curl -s "http://backend:4000/api/tenants/resolve?host=<host>"
   ```

   404 = the registry does not know the host — allow 60 s for the poll
   after a verify before concluding failure.
6. **Caddy logs** for on-demand issuance errors (ACME failures, ask
   endpoint unreachable).

## Fix

| Symptom | Fix |
|---|---|
| DNS wrong (TXT/CNAME mismatch) | Send the tenant the TXT/CNAME instructions from the console; re-check after they fix DNS (step 3 above, or wait for the 60 s poller). |
| DNS right but still `PENDING` | Force a re-check (step 3). DNS propagation can lag the tenant's own `dig` — wait and re-check. |
| TLS ask 404 on a `VERIFIED` domain | Check the tenant is not `DELETED`, and that `TLS_ASK_TOKEN` (or `INTERNAL_SERVICE_SECRET` fallback) matches what Caddy sends. |
| Cert issuance failing | Check Caddy can reach the ACME endpoint and the ask endpoint is reachable on the private network; check Caddy logs for the ACME error. |
| Wrong tenant served | Stop: this is a routing/isolation defect, not a DNS problem. Do not "fix" it by editing domains — preserve logs and escalate as a security incident (see README). |
| Removed domain still serving | Expected for up to ~2 minutes (registry + storefront cache). If it persists beyond ~5 minutes, check the registry sync (`lastError` in backend logs) and the storefront host cache. |

## Verify

- `https://<host>/` serves the tenant's storefront with a valid certificate.
- `https://<host>/admin/sign-in` reaches the tenant admin.
- The TLS ask probe returns 2xx for the host.
- The tenant's canonical subdomain still works (removal falls back to the
  subdomain as primary).

## Escalation

- All custom domains failing at once = Caddy or platform-api outage —
  see runbook 5.
- Single-tenant DNS issues stay with support; do not edit platform DNS
  records for one tenant.
