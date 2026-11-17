# Runbook 2 — Payment backlog (proofs piling up / billing jobs not running)

**Severity:** P1 (revenue-affecting). Backlog older than one billing cycle =
page Boss.

## Symptoms

- Proof queue growing in the console (`/billing` Proofs tab).
- Invoices not issued at period end; trials not expiring on schedule.
- `GET /jobs` shows a stale `lastRun` or a `lastError` on one or more jobs.

## Background

Five billing jobs run on an in-process interval runner in platform-api
(`BILLING_JOBS_ENABLED`, `BILLING_JOBS_INTERVAL_MS` default 1 hour,
overlap-guarded, **single instance only — no cross-instance lock**):

| Job | What it does |
|---|---|
| `trial-expiry` | Trial-ending reminders (3 days before, once) + expired trials → first renewal invoice + `PAST_DUE` with grace |
| `renewal-invoices` | Invoices for periods ending within 3 days; applies pending next-period plan changes; expired periods → `PAST_DUE` |
| `reminders` | `DUE_SOON` (due within 3 days) and `OVERDUE` invoice reminders, once each per invoice |
| `grace-suspend` | `PAST_DUE` past `graceEndsAt` → `SUSPENDED`; `SUSPENDED` past `BILLING_CANCEL_AFTER_DAYS` (default 30) → `CANCELLED` |
| `cancel-at-period-end` | Subscriptions with `cancelAtPeriodEnd` past period end → `CANCELLED` |

All five jobs are **idempotent** — a manual re-run is a no-op for work
already done. Job state is in-memory (`lastRuns`): it is lost on restart
and there is no persistent history.

Payment proofs carry a duplicate-transaction guard: a partial unique index
on `PaymentProof(methodId, transactionId)` where the proof is
PENDING/APPROVED. A resubmission with the same transaction id 409s until
the live proof is resolved; a **rejected** proof frees the transaction id.

## Diagnosis

1. **Job status:**

   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" "$PLATFORM/jobs"
   ```

   Check each job's `lastRunAt`, `lastResult.counts`, and `lastError`.
   A `lastRunAt` older than ~2× the interval means the runner is not
   ticking.

2. **Runner config:** confirm `BILLING_JOBS_ENABLED=true` on the
   platform-api container, and that **exactly one** platform-api instance
   runs with jobs enabled (two instances double-run; jobs are idempotent
   so this is wasteful, not corrupting — but fix it anyway).

3. **Logs:** platform-api logs for `BillingJobsService` — per-tenant
   errors are logged with the tenant id; a job-level exception is logged
   once per tick.

4. **SMTP:** invoice/reminder mail fails closed without SMTP. Test it:

   ```bash
   curl -s -X POST -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"to":"<operator-email>"}' "$PLATFORM/settings/smtp/test"
   ```

   (Check the exact test endpoint payload in the console — the settings
   page has a Send test email action.)

5. **Duplicate-txn 409s:** if proof approvals 409, find the live proof:

   ```sql
   SELECT id, "tenantId", status, "transactionId", "createdAt"
     FROM "PaymentProof"
    WHERE "methodId" = '<method-id>' AND "transactionId" = '<txn-id>'
      AND status IN ('PENDING', 'APPROVED');
   ```

## Fix

- **Jobs not ticking:** trigger manually — all jobs, or one job:

  ```bash
  curl -s -X POST -H "Authorization: Bearer $TOKEN" "$PLATFORM/jobs/all/run"
  curl -s -X POST -H "Authorization: Bearer $TOKEN" "$PLATFORM/jobs/reminders/run"
  ```

  If a tick is stuck (in-memory runner, no persistent lock to clear),
  restart the single platform-api instance and re-trigger.

- **Proof queue:** work it oldest-first in the console. For a duplicate-txn
  409, resolve the live proof with the same `(methodId, transactionId)`
  first (approve or reject it) — rejecting frees the transaction id for
  resubmission.

- **Missed invoices / missed expiries:** a manual `POST /jobs/all/run`
  catches up everything idempotently — the jobs act on state, not on
  having run at a specific time. Verify counts in the response.

## Verify

- `GET /jobs` shows a fresh `lastRunAt` for all five jobs with empty
  `lastError`.
- The proof queue drains; invoices exist for the affected period ends.
- Spot-check one tenant: invoice issued, reminder sent (or recorded in
  `InvoiceReminder`), status transitions as expected.

## Escalation

- Jobs erroring on **every** run = DB or mail outage — check
  `GET $PLATFORM/health` (platform DB ping) and the SMTP test; see
  runbook 6 if the platform DB is the problem.
- Backlog older than one billing cycle = page Boss (revenue-affecting).
- Never edit invoice/subscription rows by hand to "catch up" — run the
  jobs; they are the state machine.
