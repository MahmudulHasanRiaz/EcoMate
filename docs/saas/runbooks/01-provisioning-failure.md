# Runbook 1 — Provisioning failure

**Severity:** P1 for the affected tenant (they paid attention, verified
email, and are stuck); P0 if **all** signups fail — that is a platform
outage, escalate to Boss.

## Symptoms

- Owner stuck on "Preparing your store" on the landing verify page, or the
  verify page shows the failed state with a retry button.
- Tenant row is `PROVISIONING` in the console long after signup.
- `ProvisioningJob` is `FAILED`, or `RUNNING` older than
  `PROVISIONING_STALE_MS` (default 10 minutes).

## Background (what is supposed to happen)

Signup → email verify (idempotent) → `ProvisioningService.startForSignup`
runs async: it resolves the default plan version, creates the tenant +
subscription rows, then calls the tenant backend's internal bootstrap
endpoint (`TENANT_BACKEND_URL` + `/internal/provisioning`) to seed the
tenant workspace. The job is resumable: a failed run leaves the tenant
`PROVISIONING` and the job `FAILED` with the error (truncated to 2,000
chars); a stale `RUNNING` job is swept to `FAILED` after
`PROVISIONING_STALE_MS` so the owner can retry. Partial seeds are rolled
back; platform rows are reused on retry.

## Diagnosis

1. **Get the job state** (public endpoint, needs the signup token — ask the
   owner for their verify link, or find the token hash in the DB; the raw
   token is only in the verification email):

   ```bash
   curl -s "$PLATFORM/public/signup/status?token=<raw-token>"
   ```

   This returns the job status, current step, and error text.

2. **Read the job row directly** (platform DB):

   ```sql
   SET TIME ZONE 'UTC';
   SELECT id, "tenantId", status, step, attempts, error, "createdAt", "updatedAt"
     FROM "ProvisioningJob"
    WHERE "tenantId" = '<tenant-id>'
    ORDER BY "createdAt" DESC LIMIT 5;
   ```

   The `error` column is the ground truth. Common values:
   - `DEFAULT_PLAN_VERSION_ID is not a usable plan version` — the explicit
     default plan version was archived/deleted, or the env var points at a
     nonexistent version. **Every** signup fails this way until fixed.
   - `No plan version is available for provisioning` — no active plan
     version exists at all (fresh seed with no plans).
   - Connection/timeout errors mentioning the tenant backend — the
     bootstrap endpoint is unreachable from platform-api.

3. **Check the default plan version is usable:**

   ```sql
   SELECT key, value FROM "PlatformSetting" WHERE key = 'default_plan_version_id';
   ```

   Then confirm the referenced version exists and is not archived:

   ```sql
   SELECT id, "planId", version, "archivedAt" FROM "PlanVersion" WHERE id = '<id>';
   ```

   Also check the `DEFAULT_PLAN_VERSION_ID` env var on platform-api — env
   wins over the setting. If both are unset, provisioning falls back to the
   **newest** active plan version; verify one exists and is the intended
   trial plan (a newly published paid version silently becomes the signup
   default — see `docs/saas/phase-6-progress.md` §F1).

4. **Check platform-api → backend connectivity:**

   ```bash
   # From inside the platform-api container:
   curl -s -o /dev/null -w '%{http_code}\n' "$TENANT_BACKEND_URL/health"
   ```

   And check platform-api logs for `ProvisioningService` errors around the
   signup time.

## Fix

- **Owner retry (single tenant, transient failure):** the owner clicks
  Retry on the verify page (`POST /public/signup/retry`, rate-limited to
  5/hour per token), or the operator retries via the console. The job is
  resumable — platform rows are reused, only the partial seed is rolled
  back.
- **Bootstrap endpoint down:** restore the backend first, then retry. Do
  not hand-create tenant rows.
- **Bad default plan version:** set a valid `default_plan_version_id`
  (platform setting, or `DEFAULT_PLAN_VERSION_ID` env + platform-api
  restart) pointing at the intended trial plan version, then retry the
  affected signups. Verify with a fresh test signup afterwards.
- **No plan versions at all:** create/publish a plan version in the console
  first, set it as the default, then retry.

## Verify

- `GET /public/signup/status` returns `SUCCEEDED` and the tenant is `TRIAL`
  (or `ACTIVE` for a free plan) in the console.
- The owner can sign in to the tenant admin at
  `https://<slug>.ecomate.bd/admin/sign-in`.
- Backend registry resolves the tenant (check backend logs for
  `Tenant registry refreshed` including the new slug, within 60 s).

## Escalation

- Repeated failures **across tenants** = platform-api ↔ backend
  connectivity or a DB problem; check both health endpoints
  (`GET $PLATFORM/health`, `GET $BACKEND/health`) and the container logs.
- A single tenant failing repeatedly after the fix = read the job `error`
  text and the tenant-backend bootstrap logs for that tenant id.
- Never hand-create tenant/subscription rows to "unblock" a signup — the
  provisioning job owns that state machine.

## Prevention

- Publishing or archiving a plan version requires re-checking the signup
  default (launch-checklist rule). Prefer the `isDefault` flag on the plan
  version in the console over the env/setting override.
- Alert on provisioning failure rate (signup → provision success < 95% over
  a rolling hour is a canary rollback trigger).
