# Phase 8 — Hardening and launch (Stages 0–2, VM work)

Master-plan Phase 8, done in one shot like Phase 7 — but only the stages
that can be done on the VM. Stages 0–2 (P0 security + data-safety fixes,
deployment wiring + local validation, observability + backup + load +
runbooks + E2E harness) are DONE and verified below. Stages 3–7 (Boss prep,
staging deploy via Boss's Chrome, canary, public launch, old-repo archive)
need Boss, DNS, and the VPS, and are NOT started.

Design doc: `~/workspace/ecomate-review/phase-8-design.md` (workspace only).
Audit reports: `~/workspace/ecomate-review/phase-8-audit/01–04`.

- [x] Stage 0 — P0 security + data-safety fixes (items 1–12)
- [x] Stage 1 — Deployment wiring build + local validation (items 13–18)
- [x] Stage 2 — Observability, backup, load, runbooks, E2E harness (items 19–32)
- [ ] Stage 3 — Boss prep: decisions, DNS, VPS, secrets (items 33)
- [ ] Stage 4 — Staging deploy + hands-on staging E2E (items 34–36)
- [ ] Stage 5 — Canary, 7 days minimum (item 37)
- [ ] Stage 6 — Public launch go/no-go (item 38)
- [ ] Stage 7 — Old repo archive/LTS + maintenance policy (item 39)

## Stage 0 — P0 security + data-safety fixes

1. **Platform login brute-force protection.** Redis-backed global rate
   limiter (login 20/IP/10min, refresh 60/IP/1min, MFA challenge 10/IP/10min,
   verify/status 30/IP/1min, invite-accept 10/IP/10min; `Retry-After` on
   429) + per-account progressive lockout (5 failures → 423, 5 min doubling
   to a 240 min cap) + `auth.login.failed` / `auth.login.success` audit.
   Live-verified: 21st login 429s, 6th bad password 423s, correct password
   while locked still 423s.
2. **READONLY over-read fix.** Centralised `READ_ROLES`
   (SUPERADMIN/BILLING/SUPPORT) on all previously unannotated GETs in
   billing (11), tenants (3), plans (2), domains-admin (2), jobs (1).
   `authorization-coverage.spec.ts` fails CI when any non-public handler
   lacks `@Roles()` or the published matrix disagrees with the annotations
   (negative-tested by temporarily stripping an annotation). Live: READONLY
   403 on all 22 swept GETs, 200 only on `/auth/me` + `/auth/mfa/status`.
   Pre-existing matrix correction: SUPPORT Billing was `read` in
   `role-matrix.ts` but billing approve/reject POSTs deliberately include
   SUPPORT (Phase 7) — corrected to `write`, now enforced by the spec.
3. **runPerTenant casing fix (D1).** The sweep filtered
   `tenant.status === 'active'` (lowercase) while the platform enum is
   UPPERCASE, so every per-tenant sweep silently processed zero tenants.
   Now `toUpperCase() === 'ACTIVE'`, with per-sweep tenant-count logging
   and a warn on zero ACTIVE tenants. Regression specs with UPPERCASE
   registry records. Live: 30 sweeps logged `sweeping 1 tenant(s)`,
   zero false warnings.
4. **Fallback-tenant UUID (D2).** `effectiveTenantId()` and
   `tenantCompound()` (~89 call sites), `better-auth/prisma.ts`, and the
   `main.ts` better-auth resolver now throw when `NODE_ENV ===
   'production'` and no tenant context exists; an explicitly configured
   `DEFAULT_TENANT_ID` still works as the operator's maintenance bridge.
   Test-only fallback kept. Specs prove production-throw + test-fallback.
5. **SMTP password encrypted at rest.** AES-256-GCM (`enc:v1:`) with
   `APP_ENCRYPTION_KEY`, copied from the backend pattern; legacy plaintext
   rows lazily migrated on read; fail-closed on undecryptable values.
   Live: stored pass is ciphertext, independently decrypted to the
   original; a planted plaintext row migrated on restart.
6. **Boot-time DB-role bypass check.** `RlsCoverageService` queries
   `pg_roles` for the connected role; superuser or BYPASSRLS throws in
   production, warns in test/dev. (Audit doc correction: the column is
   `rolsuper`, not `usesuper`.) Live: postgres superuser refused,
   `ecomate_tenant_app` accepted, RLS coverage still 200 tables.
7. **Tenant-facing backup fenced (D5).** Deleted
   `backup/backup.controller.ts` (both controllers) — a tenant superadmin
   could dump + restore the entire shared DB. `BackupService` stays:
   scheduled backups + internal triggers untouched. Live: all tenant
   backup routes 404; the `lifecycle-recovery` repeatable job still runs.
   The tenant-admin backup UI was removed with it (item 28 follow-up).
8. **F1 signup default (D3).** `PlanVersion.isDefault` + partial unique
   index + `POST /plans/:id/versions/:versionId/set-default`
   (SUPERADMIN/BILLING) + console badge/button. Provisioning prefers
   `isDefault`, fails closed on an unusable default; env/setting override
   kept. The Trial plan's v1 is the default (migration DML + seed guard).
   Live: a newer v2 does not steal signups; the index rejects a second
   default; flipping works both directions.
9. **Mobile-builder reads gated.** `@Permissions('view_mobile_builder')`
   on `GET metadata/ready/builds/builds/:id` (the key already existed in
   the permission catalogue). Live: customer 403 on all four reads, owner
   200. The `@Public()` builder-callback endpoint is intentionally
   unchanged.
10. **TOTP MFA, enforced for SUPERADMIN (D4).** Node-crypto RFC 6238
    (verified vs RFC vectors), secret encrypted at rest, 10 single-use
    hashed recovery codes, login second step, SUPERADMIN enrollment
    enforced at login; console setup/verify/recovery on login + account
    pages; `POST /users/:id/mfa/reset` (SUPERADMIN, self-reset refused).
    Live: full enroll → challenge → recovery-code login → regenerate →
    reset flow green. NOTE: the seed admin has no MFA enrolled, so it gets
    `mfaRequired + mfaSetupRequired` at login until enrolled.
11. **Platform-api hardening.** `@fastify/helmet` (headers verified live);
    the signup limiter moved to the Redis-backed global limiter covering
    login/verify/status/invite-accept/refresh; refresh-token reuse
    detection with a 30s grace (in-grace replay = plain 401, late replay
    revokes the whole family + `auth.refresh.reuse` audit). Live: a family
    of 3 tokens revoked after a late replay.
12. **Impersonation `imp` claim consumed.** The backend guard propagates
    `imp`/`impActor` onto `request.user` and stamps
    `tenantContext.impersonation` in ALS; the security-event emitter merges
    it into every event's metadata (no schema change). Platform-api's
    impersonation `consume` now returns `actorId` + `actorEmail`.
    Password change and POS analytics export 403 during impersonation.
    Live: impersonated change-password/export 403; the persisted
    `rate_limit_exceeded` event carries the impersonation flag.

## Stage 1 — Deployment wiring + local validation

13. **Dockerfiles.** `platform-api` (modelled on backend, no obfuscator
    per D15, `startup.sh` doing DB-create → `migrate deploy` → optional
    seed → start; the build copies `src/generated` into `dist/` — tsc
    does not copy the Prisma client's JS), `platform-admin` (Vite → nginx
    + new `nginx.conf`), `landing` (standalone, port 3002, new
    `/api/health` route), `apps/caddy/Dockerfile` (edge image).
14. **Compose.** 4 new services (platform-api internal-only :4100,
    platform-admin, landing, caddy :80/:443), 3 new volumes
    (`platform-exports-data`, `caddy-data`, `caddy-config`). Backend gains
    `PLATFORM_API_URL` + `INTERNAL_SERVICE_SECRET` + a `platform-api:
    service_started` ordering dependency. Tenant DB name standardised on
    `ecomate` (D9); `license-data` volume name kept. Postgres
    `max_connections=300` (D6) + slow-query settings
    (`shared_preload_libraries=pg_stat_statements`,
    `log_min_duration_statement=500`, `statement_timeout=30000`).
    Backend memory raised to 2560M / heap 2048M and
    `TENANT_PRISMA_MAX_CLIENTS` lowered to 30 after the k6 measurement
    (see item 24).
15. **CI.** `ci.yml` gained inputs + unit steps + 4 build jobs for the new
    apps, a `caddy validate` job, and a platform migration-safety gate
    (jest `migration-safety` + `deploy-safety` suites).
    `build-service-image.yml` needed no change. Item 27 added the
    `rls-gates` + `security-scan` jobs (see below).
16. **Caddyfile rewrite.** Host-routed: `www` → landing, `saas` →
    platform-admin (`/api` → platform-api), `api` → platform-api,
    `:443` tenant block with on-demand TLS via the ask endpoint
    (`:4100/api/internal/tls/allow`), `:80` ACME passthrough + HTTPS
    redirect. Hosts + ACME email from env vars (defaults
    `www`/`saas`/`api.ecomate.bd`, `support@ecomate.bd`). Validation found
    and fixed a real bug: Caddy's built-in 308 auto-redirect shadowed the
    explicit `:80` site and would have broken HTTP-01 issuance —
    `auto_https disable_redirects` added. The caddy healthcheck probed `/`
    on the admin API (a 404) — now probes `/config/`.
17. **Portainer + env sync.** `portainer-stack.json` rewritten (EcoMate
    repo URL, 123 env entries incl. the 4 new Stage 0 platform-api vars
    and the 22 new Stage 2 observability vars). Root `.env.example`
    synced (`BILLING_*` added — missing since Phase 7,
    `APP_ENCRYPTION_KEY` deduped, `PLATFORM_LANDING_URL` default fixed).
    `scripts/backup-db.sh` covers the platform DB; stale `deploy.sh`
    rewritten as a manual helper; `docs/deployment/portainer-deployment.md`
    removed; master-plan §3.7 ask-endpoint URL corrected to
    `:4100/api/internal/tls/allow`.
18. **Full local validation: 35/35 green.** All 8 images build; the whole
    stack boots; migrate + seed; signup → verify → provisioning (job
    SUCCEEDED, tenant TRIAL) → ask endpoint (allow 200 / unknown 404 /
    platform host 404 / bad token 401) → tenant storefront + `/api` +
    `/admin` + `/pos` via Caddy with on-demand TLS → owner login via
    Caddy tenant host → host routing + bare-domain 301 → `:80` 301 +
    ACME passthrough → seed-admin MFA gate + disposable BILLING login;
    `caddy validate` passes; slow-query settings confirmed live via SHOW.
    Honest caveat: plain `docker compose up` cannot run in this sandbox
    (the daemon's runc cannot start containers — setns EPERM), so the
    stack ran via standalone buildkitd + direct crun from the rendered
    compose env, not vanilla compose. The first full staging deploy must
    re-prove the vanilla path.

## Stage 2 — Observability, backup, load, runbooks, E2E harness

19. **Structured tenant-tagged logging (D8).** nestjs-pino JSON logger in
    backend + platform-api; every line carries `service` + `tenantId`
    (backend, from ALS) + `requestId` (both). One structured access log
    per request; Fastify's untagged request lines suppressed. Redaction
    covers passwords/tokens/secrets/authorization/cookies (+ platform
    `mfaSecret`, `inviteToken`, `tempPassword`). Live: request ids agree
    between header and log line (a `req-N` mismatch was found and fixed).
20. **Metrics + queue dashboard + alerting + Sentry (D8).** Prometheus
    `/metrics` on both apps (HTTP duration/counts — never tenant ids as
    labels — BullMQ gauges for all 10 queues, tenant Prisma client cache
    gauge, billing-job gauges, TLS probe gauges). Bull Board at
    `/api/admin/queues`, superadmin-only (impersonated tokens rejected),
    with a `BULL_BOARD_ENABLED` kill-switch. Email alerts (direct SMTP,
    never through the email queue) for billing-job failure, purge-sweep
    failure, backup failure, restore failure, queue depth/failed jobs,
    TLS expiry/unreachable, primary-domain unhealthy — backup-failure and
    restore-failure alerts both fired live. Sentry wired, inert on a
    placeholder/unset DSN (no account, no spend).
21. **Slow-query monitoring.** Compose Postgres settings verified live on
    a scratch cluster (a 600 ms query was logged and appears in
    `pg_stat_statements`). Runbook query in `docs/saas/runbooks/`.
    NOTE: `pg_stat_statements` must be created in-DB by a superuser —
    the preload alone does not create the view.
22. **Platform-DB backup + scheduled backups ON + R2 offsite.**
    `db_files` backups now dump `PLATFORM_DATABASE_URL` into
    `platform.sql` inside the existing tar artifact (+ manifest flags);
    restore replays it FIRST (a platform failure aborts before the tenant
    DB is touched). Scheduled backups are ON by default with `db_files`
    scope (was OFF / `db_only`); explicit tenant settings respected. R2
    offsite upload was already wired — verified live against a fake-S3
    server. **PITR/WAL archiving is DEFERRED** (needs compose postgres
    changes + a WAL store + a restore procedure); operational RPO without
    it is the daily schedule (up to 24h).
23. **Restore drill — MEASURED 2026-11-17, both DBs.** A real `db_files`
    backup was restored into scratch DBs via the real in-app restore job.
    **RTO: 6.0 s** (flip+enqueue → job finished, seed-size DBs — scales
    with DB size, re-measure on staging data). **RPO: ~5 min** backup age
    at restore; **operational RPO 24 h** (daily schedule, no PITR).
    Integrity verified (tenant 205 tables / 7 trigram indexes / pg_trgm;
    platform 29 tables with matching counts; point-in-time fidelity
    proven). The drill caught TWO launch-blocking restore bugs, both
    fixed + spec-locked: pg_dump with `--schema=public` emits NO `CREATE
    EXTENSION` (every backup was unrestorable), and the replay destroyed
    the tenant role's grants (`regrantTenantAppRole()` added). Also fixed:
    the `ecomate_control.backup_restore_operation` table never existed
    (migration `0003_restore_control_table`).
24. **Pool decision (D6, revised by measurement) + k6.** k6 v2.4.0
    installed to `~/.local/bin`; scenarios 1–6 committed under
    `tests/load/`. The D6 theory (connections are the constraint) was
    WRONG: **memory is the binding constraint** — per-tenant Prisma
    clients cost ~25–40 MB; PG peaked at 185/300 connections, never the
    ceiling. Measured on the 8 GB shared VM (1.5 CPUs) against dev
    servers with the exact compose PG flags (docker stack-up impossible
    in this sandbox — see item 18): baseline 50 VUs / 3 tenants **0.00%
    failed** (p95 5.12s — pool queueing + small box, not the DB; no query
    exceeded 500 ms); pool-saturation ramp 10→150: **45.52% failed**,
    backend OOM'd ~7 min in. Measured ceilings: soft (eviction churn)
    **~10 tenants under load** (background sweeps pre-warm ~46/60
    clients); hard (first pg-pool timeout) **~30 tenants**; backend OOM
    **~60–100 tenants**. DECISION (coordinator, from the measurement):
    backend memory 2560M, heap 2048M, `TENANT_PRISMA_MAX_CLIENTS=30`
    (worst-case heap fits; 30 matches the measured hard ceiling), applied
    to compose + `.env.example` + stack template together. Re-tune after
    the staging k6 run on real hardware. Scenarios 2/4/5/6 were NOT run —
    they would re-prove the same collapse; re-run after the staging
    re-tune. First baseline attempt measured the abuse blocker (100
    req/min/IP), not the system — scripts + README now use
    `x-internal-secret` for direct backend calls.
25. **TLS/domain health job (D12).** Hourly probes of verified custom
    domains (handshake + expiry + reachability), transitioning `tlsStatus`
    (PENDING/ACTIVE/EXPIRING_SOON/EXPIRED/UNREACHABLE) with alerts <14
    days to expiry; the manual `SAAS_PRIMARY_UNHEALTHY` flag is now a
    manual override over a real primary-domain probe (2 consecutive
    failures to flip unhealthy, 1 success to recover). All transitions
    verified live with alerts in the sink; a prober bug (expired certs
    classified UNREACHABLE) was fixed.
26. **Export/purge hardening.** Tenant-attributable upload key scheme
    `t/<tenantId>/` + media purge on tenant purge; chunked + async
    streaming export with progress + encryption (no more 30s timeout /
    250k-row cap blocking large tenants); export-file retention sweep;
    queued jobs for purged tenants skipped/cancelled; CLI scripts
    `scripts/saas/export-tenant.ts` + `purge-tenant.ts`. Live-verified
    36/36. Purge now also deletes orphaned `SignupRequest` rows (they
    blocked re-signup forever with a 409) — live-verified re-signup
    works. Production purge verified NOT to leave Better Auth rows.
    Details: `docs/saas/export-purge.md`.
27. **RLS gates into CI.** `scripts/saas/ci-guards.mjs` (plan §8: 2
    PrismaClient sites, both allowlisted; 38 `$queryRawUnsafe` sites,
    all tenant-scoped; 203 models / 3 global) — PASS locally. `rls-gates`
    job (disposable PG16 → migrate → role+grants → `check_rls.sql` must
    return zero rows → `rls_smoke_test.sql` as `ecomate_tenant_app`) and
    `security-scan` job (npm audit high+ / OSV / gitleaks) in `ci.yml`;
    build-backend now needs `rls-gates`. `.gitignore` covers `.env.*`
    except `.env.example`. SQL gates validated locally on a disposable
    migrated DB (`check_rls.sql` 0 rows, smoke PASS). Limits: npm audit /
    gitleaks / OSV cannot run in this sandbox (egress proxy blocks the
    audit endpoint) — CI jobs wired + YAML-validated only. The §9.1
    isolation-suite expansion was deferred (DB-backed proof is
    `rls_smoke_test.sql` in CI).
28. **Small hardening items.** Backend `/health` includes Redis + queue
    checks; readiness vs liveness split; storefront proxy host-cache
    evicts oldest instead of `clear()`; billing-job scans gained a
    `dueAt` predicate + `take` batching; UUID assertion in
    `TenantPrismaManager.getClient()`; storefront CSP promoted from
    Report-Only to enforcing (+ security headers on landing); media URL
    ingest reuses `secure-fetcher` DNS pinning (SSRF TOCTOU closed);
    tenant owner signup password minimum 8 → 12; backend
    authorization-coverage spec (fails CI if a non-`@Public()` handler
    has neither `@Roles` nor `@Permissions`) — 6 real gaps fixed,
    including courier search + order SSE. Extras found and fixed along
    the way: platform-token rate-limit exemption, storefront `/api`
    rewrite forwarding (+ `x-internal-secret` injection for `/api/*`),
    admin vite proxy Host, SafeImage resize URL, PageViewTracker
    `crypto.randomUUID()` crash on plain HTTP (guarded fallback UUID).
29. **Runbooks.** All six in `docs/saas/runbooks/` + README:
    provisioning failure, payment backlog, tenant suspension,
    custom-domain failure, domain/fallback outage, DB restore (filled
    with the measured drill numbers). The obsolete single-tenant
    `docs/deployment/client-onboarding-runbook.md` is bannered OBSOLETE.
30. **Landing product gaps (D11).** Live pricing display (calls
    `GET /public/plans`), terms/privacy pages, sign-in page + login link
    for returning owners, trial-days copy read from the plan (never
    hardcoded), `logoUrl` renderer, favicon.
31. **Committed E2E harness — 55 checks, 9 scenarios, all PASS.**
    `scripts/saas/phase8-e2e/` (+ `test:e2e:phase8` npm script): E1
    landing signup 10/10, E2 provisioning-failure retry 4/4, E3 admin
    shop setup 6/6, E4 live order + cross-tenant isolation 7/7, E5
    suspended/grace checkout 7/7, E7 custom-domain negative 10/10, E8
    alias/fallback 6/6, E9 fallback-outage mode 4/4, E11 Phase 4 script
    re-run 1/1 (18/18 inner checks). E6/E10 need staging + real DNS
    (Stage 4). The harness found and fixed real bugs: tenant-host alias
    resolution for nested base domains, storefront thank-you SSR with no
    tenant context (every customer saw "Order not found" + raw 403 JSON),
    TRIAL restores leaving the subscription SUSPENDED forever, the
    storefront `/api` rewrite, the admin vite proxy Host. One E5 checkout
    timeout flaked once and never recurred (documented, not chased).
32. **Structured internal pentest (F13) — 34 blocked, 0 vulnerable,
    0 skipped.** `scripts/saas/phase8-e2e/pentest.mjs` (36 checks): RLS
    bypass (R1–R3), tenant-host confusion (H1–H7), impersonation/JWT
    replay (I1–I9), internal-endpoint auth (P1–P5), stored XSS (X1,
    escaped), public surfaces (S1–S9). Two INFO notes: duplicate-signup
    409 reveals the email is registered (accepted low-risk, standard
    signup behaviour); the rate-limit key is IP-based.

## Bugs found by validation (beyond the item list)

- **P0 — backend would not boot after 2+ tenants existed.**
  `reconcile-hr-base.sql` ran on every boot creating GLOBAL unique
  indexes (`AccessPreset_name_key`, `Department_*`, `Designation_*`,
  `Employee_employeeId_key`). Proven live: after 3 tenants each created
  a `Manager` preset, restart failed with a duplicate-key error. Fixed:
  global CREATEs deleted from `reconcile-hr-base.sql` +
  `fix-p2039.sql`, conditional DROPs added; backend boots with 2+
  tenants, DROP-heal path verified.
- **New-tenant host 403'd for up to 60s after provisioning** (registry
  refresh interval). Fixed: provisioning-triggered refresh push; host
  routable 0.1s after provisioning. The fix exposed a production bug:
  the refresh endpoint needed `@SkipSubscription()` (403 in production,
  masked in dev).
- **Backend could not boot: `HealthModule` never imported
  `DiscoveryModule`** (`QueueHealthService` injects `DiscoveryService`).
  Unit tests never caught it (they construct the service directly).
- **Bull Board mounted at the wrong path** (landed at the app root,
  `/api/admin/queues/*` 404'd while the log claimed "mounted").
- **Platform request ids logged as `req-N`** (Fastify assigns
  `request.id` before pino-http runs) — fixed with Fastify `genReqId`.
- **`nest build` alone does not produce a runnable platform-api dist**
  (the Prisma client in `src/generated` is JS tsc doesn't copy) — the
  Dockerfile copies it into `dist/`; dev must `cp -r src/generated
  dist/src/generated` after building.

## Schema — migrations

- `apps/platform-api/prisma/migrations/20261116223521_phase8_stage0_platform_security`
  (+ `rollback.sql`): `PlatformUser` (failedLoginCount, lockedUntil,
  mfaEnabledAt, mfaPendingSecret, mfaRecoveryCodes), `PlanVersion.isDefault`
  + partial unique index + trial-v1-default DML,
  `PlatformRefreshToken.familyId` + index. Audit index already covered
  the new login-audit queries (no new index needed).
- `apps/backend/prisma/migrations/0003_restore_control_table`
  (+ `rollback.sql`): `ecomate_control.backup_restore_operation` (the
  backup fence SELECTs it on every backup; it never existed).
- Indexing rule applied throughout: every new query checked for a
  supporting index; the TLS job's domain query is served by the existing
  `@@index([status])`.

## Verification

- platform-api jest **502/502** (55 suites); platform-admin vitest
  **25/25** + `tsc -b` clean; backend jest **6488 passed / 10 skipped /
  0 failed** (469 suites passed, 1 skipped); storefront vitest **710/710**
  (95 files) + `tsc --noEmit` clean; shared-types **14/14**;
  tenant-admin vitest **1675/1675** (186 files, browser headless);
  landing vitest **36/36**. `nest build` clean for backend +
  platform-api; storefront + landing builds clean.
- Stage 0 live E2E: platform 123/123 checks (auth/throttling/lockout/
  audit, MFA, READONLY/BILLING roles, refresh reuse, SMTP encryption,
  isDefault signup, impersonation actor); backend 21/21 live checks
  (sweeps, backup fencing, mobile-builder, impersonation, production
  throw, DB-role check).
- Stage 1 local validation: **35/35** (see item 18).
- Stage 2 E2E harness: **55 checks, 9 scenarios, all PASS** (item 31);
  pentest **34 blocked, 0 vulnerable, 0 skipped** (item 32); restore
  drill RTO 6.0s / RPO ~5min / operational 24h (item 23); k6 baseline
  0.00% failed at 50 VUs / 3 tenants, ceilings measured (item 24).

## Known limits / deferred items

- Single-instance billing-job runner, no cross-instance locking (D13):
  never scale platform-api past 1 replica with jobs enabled.
- No PITR/WAL archiving (item 22): operational RPO is 24h (daily full
  backups). Revisit when the staging stack is stable.
- k6 scenarios 2/4/5/6 not run (item 24): re-run after the staging
  re-tune of the D6 memory decision.
- npm audit / gitleaks / OSV wired in CI but never executed anywhere
  yet (sandbox egress blocks the audit endpoint); the first CI run on
  the pushed branch is the first real execution.
- §9.1 isolation-suite expansion deferred (item 27); DB-backed proof is
  `rls_smoke_test.sql` in CI.
- `better-auth/prisma.ts` is the second `new PrismaClient` site,
  allowlisted in `ci-guards.mjs` (tenant-scoped via ALS, fail-closed);
  unlike `TenantPrismaManager` it has no UUID assertion — consider
  adding it for symmetry.
- Unknown-tenant base hosts return 200 (error shell, no tenant content)
  rather than 404 — by proxy design (a stale registry must not 404 a
  valid base host).
- Reactivation mail fires on ACTIVE restores only, not TRIAL restores
  (product choice).
- Production notes: Redis must be `noeviction` (BullMQ); `pg_stat_statements`
  must exist in-DB on staging/prod; `BACKUP_WORK_DIR` must point at real
  disk, not /tmp; pg_dump needs the superuser DATABASE_URL (RLS blocks
  the app role — do NOT grant BYPASSRLS to `ecomate_tenant_app`); the
  seed admin needs MFA enrollment before first console login.
- Standing caveats (unchanged): entitlement refresh is 60s periodic +
  request-time; production email needs SMTP; custom domains need real
  DNS; credit-paid invoices don't extend subscriptions; Phase 9 still
  deferred.

## Next

Stage 3 (Boss prep: the 15 decisions in design doc §F, DNS, VPS check,
secrets) and Stage 4 (staging deploy via Boss's Chrome + hands-on
staging E2E, incl. E6/E10 on real DNS) — both need Boss and are NOT
started. Do not start them without Boss.

## Post-Phase-8 follow-ups (2026-11-17)

- **Build Images run #3** (commit 8e404ee, 18m 4s): all 8 images built and pushed to GHCR; unit tests fully passed; guards + RLS gates + caddy validate passed. Only the OSV security scan failed — one real Medium finding: Next.js 16.4.1, GHSA-mfr8-8qww-v76h (CVSS 6.3), fixed in 16.4.5. Fixed by bumping `next` 16.4.1 → 16.4.5 in storefront + landing (+ lockfile).
- **JS obfuscation removed** (Boss decision, 2026-11-17): it was a single-tenant measure (code shipped to clients' servers). In the SaaS model the code never leaves our servers, so obfuscation only slowed the backend build and mangled stack traces. Removed the `obfuscator` stage from `apps/backend/Dockerfile` (backend is 2-stage again), deleted `apps/backend/obfuscator.config.json`, updated the platform-api D15 comment + README. Frontend minification (Next/Vite defaults) is unchanged.
- **No unnecessary rebuilds** (Boss, 2026-11-17): GHA layer caching (`cache-from`/`cache-to`, `mode=max`, per-service scope) was already wired in `build-service-image.yml` — run #3 was the first run where all 8 builds actually ran, so it populated the cache from scratch. From run #4 on, images whose inputs did not change rebuild from cache in seconds. The stale "per-service path filtering" comment in `build-service-image.yml` was corrected (ci.yml is dispatch-only with per-service toggles; there is no path filtering).

## Staging fix round (2026-11-17)

Staging deployed 2026-11-17 (stack `ecomate-staging`, temp VPS, expires
19 Nov 2026) and swept hands-on for 24 minutes: 17 functional (F1–F17),
11 design (D1–D11) and 5 responsive (R1–R5) problems, plus MFA QR (#1),
native dialogs (#2) and Bitwarden interference (#3). Full sweep log:
`~/workspace/ecomate-review/staging-sweep-notes.md` (workspace only).
This round fixes all of them in one commit; staging redeploy + live
re-verification follow separately.

### Console redesign — StackMate Neon, blue accent

Boss direction: the SaaS admin console must look like StackMate's Neon UI
(`feat/stackmate-full-implementation`), with Neon's green #00E599 replaced
by EcoMate's brand blue #4f6bf2 (success stays green #10b981). New token
system `apps/platform-admin/src/styles/tokens.css` (`--em-*`, dark default
page #000 / surface #101010, light alternate), theme toggle (dark/light/
system, localStorage `ecomate.platform.theme`, applied before React
mounts), primary button solid white/black per Neon (never blue fill), max
4px radius, Inter Variable. The rewrite also defines the CSS classes the
pages already used but that never existed (`panel`, `inline-form`,
`data-table`, `row-actions`, `detail-list`, `form-actions`, `pagination`,
`clickable-row`, `notice--warning`) — their absence was the root cause of
the broken Users/Account/Audit form layouts (D3/D4/D5). New shared
primitives in `components/ui.tsx`: toast system, ConfirmDialog, Modal.
Mobile: real drawer + hamburger under 900px (R2); tabs scroll instead of
wrapping (D6/R5); tables get sticky headers + nowrap dates/UUIDs (D8).

### Functional fixes (root causes verified in code first)

- **F1 tenant create (blocking).** New `/tenants/new` page (name, slug
  auto-derived, owner email/phone/password, plan, trial-days override).
  The API gap went beyond the missing UI: `POST /tenants` created the
  tenant but never provisioned it. `CreateTenantDto` gained optional
  `ownerPassword` (min 8); when provided, the service creates a VERIFIED
  synthetic signup request (bcrypt, 12 rounds — same as signup) and
  awaits `provisioning.startForSignup`, sets status PROVISIONING first
  (run flips to TRIAL on success, stays PROVISIONING + FAILED job on
  failure), and audits `tenant.provisioning`. New
  `POST /tenants/:id/provisioning/retry` (SUPERADMIN/BILLING/SUPPORT)
  + retry button on the tenant detail provisioning banner.
- **F2 plan management.** Plans page rewritten: create plan (+ first
  version), edit plan, new version, archive — all in-app modals with
  shared version fields (price/currency/interval/CUSTOM days/trial/
  grace/features/limits JSON validated as numbers). Preview-apply and
  set-default kept.
- **F3 payment methods in Billing.** New 8th Billing tab listing the
  methods (fetched from `/billing/methods`) with a "Manage in Settings"
  link — discoverable without duplicating CRUD.
- **F4 invoice creation.** Resolves with F1; the invoice form also shows
  "Create a tenant first" + link when no tenants exist.
- **F5 invite feedback (blocking).** Root cause: `UsersService.invite()`
  deleted the invite and threw when mail failed (no SMTP in production),
  so the console's `{delivered: false}` handling and pending-invites list
  were unreachable. The invite is now kept on mail failure, the attempt
  is audited with `delivered: false` + error, and the API returns
  `{delivered, acceptUrl, deliveryError}` so the operator can share the
  link. Console shows the link in a warning notice with Copy; the
  pending-invites section is always visible with an explicit empty state.
- **F6 audit gaps.** Jobs controller now audits operator-triggered runs
  (`jobs.run`, `jobs.run-all`, `jobs.tls-health.run` with counts/errors)
  — scheduled ticks are deliberately NOT audited (5 jobs x 24/day would
  flood the log). Invite attempts are covered by the F5 fix.
- **F7 test email disabled.** The button was `disabled` while SMTP was
  unconfigured — exactly when it is needed. Now enabled whenever an
  address is entered; the API surfaces its clear "not configured" error
  in-app, with a hint under the button.
- **F8 Bitwarden autofill hazard.** SMTP username/password had no
  `autocomplete`/`name`, so Bitwarden treated them as a login form and
  offered the superadmin's Gmail creds. Now `autoComplete="off"` /
  `"new-password"` + smtp-scoped names, and save refuses when the entered
  username equals the session user's email while no SMTP user was ever
  saved (with an in-app explanation).
- **F9 flaky trial-defaults save.** Root cause: after a token refresh the
  console retried with the STALE access token (`sessionRef` only updated
  during render), so the first save after expiry 401'd with "Invalid
  platform session" and the retry succeeded. Refresh now updates the ref
  synchronously (single `storeSession` path) and concurrent 401s share
  one in-flight refresh.
- **F10/F11 branding takes effect.** Branding (platform name, logo URL,
  NEW favicon URL) now drives the console: sidebar brand, tab title, and
  favicon via a `BrandingProvider` reading the new public endpoint
  `GET /public/branding` (no auth — branding is public info; registered
  in the authorization-coverage allowlist). Logo/favicon upload: file
  input -> FileReader data URL (200KB/100KB caps) stored in the branding
  JSON — no new storage infra. The DTO accepts http(s) URLs or
  `data:image/*;base64` (validated pattern + 300k length cap).
  Sidebar/login show the configured logo or a platform-initial
  lettermark, never the bare blue square (D2).
- **F12 search sync.** Clearing the search box now clears the applied
  filter; an applied-filter chip with x-clear shows the active filter
  (tenants + domains).
- **F13 confirmations.** In-app confirms added where actions executed on
  one click: coupon disable/enable, payment-method deactivate, tenant
  suspend/reactivate, cancel subscription, change plan (financial),
  user disable/enable, revoke invite, maintenance-ENABLE. Left without
  confirm deliberately: reset-owner-password (sends a code), job runs
  (idempotent), domain config save (reversible), reject-proof/credit-note
  (already require a reason form), apply-version (has a preview step).
- **F14 two dashboard layouts — NOT a code bug.** The strings of the
  first layout ("Monthly revenue", "Tenant growth", …) do not exist
  anywhere in `apps/platform-admin/src`; the only dashboard is
  `overview.tsx` (the second layout the sweep saw). No code fix;
  documented here.
- **F15 stale "Loading…".** Loading indicators rendered ALONGSIDE content
  (overview, account, domains) and tenant-detail usage showed
  "Loading usage…" forever on fetch failure. All loading states are now
  exclusive; usage failure shows an error + "Try again".
- **F16/F17 missing spaces.** JSX whitespace class: captions split across
  expressions/newlines lost their spaces ("0paying subscriptions",
  "BDT0· none overdue"). All converted to single template literals
  (metrics, landing footer "©2026EcoMate" -> "© 2026 EcoMate").
  "0 newest loaded here" was meaningless microcopy (D10), reworded to
  "Across all statuses".
- **D9 metrics chart.** The six-month trend bars ARE real data — they
  only look like placeholders when every value is 0. Now an honest empty
  state ("No collections in the last 6 months") when all zero, real chart
  otherwise. D10 casing: labels are sentence-case now (the Neon system
  drops the CSS uppercase transform).

### #1 MFA QR

`otpauthUrl` was returned by the API and present in the frontend types
but never rendered — no QR dependency existed. `react-qr-code@2.2.0`
(chosen over qrcode-generator 2.0.4 and qrcode 1.5.4: purpose-built React
SVG component, most recently maintained 2026-06-09, same qrcode-generator
engine StackMate uses; Boss allows better-than-StackMate choices).
Shared `QrCode` component (180px SVG, white card like StackMate's
`.sm-qr`) renders in both login setup and account setup, manual key +
copy kept as fallback. Live-verified locally (headless Chrome against the
dev console + local API): the QR renders on the setup screen and a TOTP
code computed from the displayed secret completes enrollment.
**Bug found by that verification (pre-existing, fixed here):** after
mid-login MFA enrollment, `verifyMfaSetup` stores the session, so the
login page's `if (session) return <Navigate to="/" />` guard fired
before the recovery-codes step could render — the user never saw their
10 recovery codes (they existed; the account page counted them). Fixed
with `if (session && step !== 'recovery')`; verified live: enrollment
now shows the codes and "Continue to the console" reaches the dashboard.

### #2 Native dialogs — all 15 sites replaced

- Console (7x `window.confirm`): billing approve-proof, domains remove,
  tenant-detail impersonate/delete, settings delete-method, users
  reset-password/delete-user -> in-app ConfirmDialog; console previously
  had NO toast/modal system at all.
- Tenant admin (7 sites): campaigns send-now (Dialog, file's own
  delete-dialog pattern), payslip approve, categories delete x2,
  product delete (shared ConfirmDialog), rich-text-editor image/link
  prompts x2 (Dialog-based URL prompt with input).
- Storefront (1 site): account address delete -> in-app modal following
  the SizeChartModal pattern.
- Grep gates (CI workflows cannot be pushed by the GitHub App, so the
  gates are tests): `no-native-dialogs.test.ts` in platform-admin
  (node:fs walk), admin (`import.meta.glob` + `?raw` — browser-mode
  suite has no node:fs, same pattern as the existing `?raw` guards),
  storefront (node:fs walk). Each gate strips comments/strings and was
  negative-tested with a probe file. No `window.alert` existed anywhere.

### #3 Bitwarden interference — evidence, not a guess

Live headers checked: the console host serves NO CSP/security headers
(helmet's strict CSP is only on the API host, not the page Bitwarden
injects into); no platform-admin code touches `document.body` (except the
standard transient download link in audit export) or wipes the DOM;
index.html has no CSP meta. The known trigger surface — the SMTP form's
unattributed password fields — is removed by the F8 fix. Root cause is
NOT conclusively provable without reproducing with the extension; verify
on staging with Boss's Bitwarden after deploy.

### Responsive (R1–R5)

R1 metrics overflow at 768px: min-width:0 chains + overflow guards in
the redesign. R2 mobile drawer under 900px. R5 tabs/buttons fixed by
scrollable tabs + nowrap buttons. 375px was untestable in the sweep
browser (zoom capped ~225%) — verified locally instead: headless Chrome
(Chrome for Testing) against the dev console + local API, logging in as
the seed superadmin with real TOTP enrollment: **all 21 page x viewport
combinations (login, overview, tenants, billing, metrics, settings,
plans x 375/768/1160px) show zero horizontal overflow**
(`documentElement.scrollWidth == clientWidth`). Screenshots + report:
`~/workspace/ecomate-review/responsive-check/`. Visual checks confirm
the Neon look, the mobile topbar + hamburger, single-column metric cards
at 375px, scrollable (not wrapping) billing tabs at 1160px, and the MFA
QR card.

### Tests (this round)

- platform-api jest: **514/514** (was 502; +12: tenants +5, jobs
  controller +4, settings +1 service +1 public-branding, users +1 net),
  `nest build` clean. The authorization-coverage spec caught the new
  public controller (3 failures) and was updated per its own design
  (allowlist entry + controller list).
- platform-admin vitest: **26/26** (was 25; +1 no-native-dialogs gate),
  `tsc --noEmit` clean.
- tenant admin vitest: **1676/1676** (was 1675; +1 gate), `tsc --noEmit` clean.
- storefront vitest: **711/711** (was 710; +1 gate), `tsc --noEmit` clean.
- landing vitest: **36/36**, `tsc --noEmit` clean.
- Live E2E on staging (tenant create -> provisioning -> subdomain + TLS
  -> storefront/admin/POS) is NOT done in this commit — it needs the
  redeploy; see Next. The 375px responsive check IS done locally (above);
  re-confirm on staging after the redeploy.

## Next

- Redeploy staging (Portainer stack `ecomate-staging`) from the new
  images after CI goes green, then re-run staging E2E end to end and
  verify every fix live: tenant create + provisioning, MFA QR with a
  fresh enrollment, Bitwarden behavior with Boss, 375px responsive.
- Still blocked on Boss: SMTP + Turnstile keys (public signup test);
  Deploy Client deletion call; SMTP billing rate/top-up decisions.
