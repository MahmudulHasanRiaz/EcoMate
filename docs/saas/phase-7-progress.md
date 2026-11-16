# Phase 7 — Billing lifecycle

Master-plan Phase 7, done in one shot: the renewal invoice job, the manual
payment verification transaction, partial/overpayment/duplicate handling,
proration, plan version application, usage enforcement (already present —
verified, not rebuilt), billing email templates, and invoice PDF/receipt.

- [x] 1. Renewal invoice job + reminders + grace/suspend/cancel state machine
- [x] 2. Manual payment verification transaction (invoice → payment →
      subscription extension → entitlement refresh)
- [x] 3. Partial payments, overpayment credit, duplicate transaction detection
- [x] 4. Upgrade/downgrade effective dates + proration (manual credit first)
- [x] 5. Plan version application to existing subscriptions (explicit)
- [x] 6. Usage counters + limit enforcement + upgrade CTA
- [x] 7. Email templates (invoice, payment approved/rejected, trial ending,
      suspension, reactivation)
- [x] 8. Invoice PDF/receipt

## What was built

### Schema — migration `20261116230000_phase7_billing_lifecycle`

- `Subscription.pendingPlanVersionId` (FK to PlanVersion, SetNull) +
  `pendingPlanEffectiveAt` — a plan change scheduled for the next period.
- New `InvoiceReminder` model: one row per (tenant, kind, reference) so each
  reminder is sent exactly once. `referenceId` is the invoice id, or the
  subscription id for `TRIAL_ENDING`.
- Partial unique index on `PaymentProof(methodId, transactionId)` where the
  status is `PENDING` or `APPROVED` — the database, not just the service,
  refuses a duplicate transaction id on a live proof.
- Rollback in `rollback.sql` next to the migration.

### Billing jobs — `apps/platform-api/src/jobs/`

Five jobs, run by an in-memory interval runner (`BillingJobsService`,
`BILLING_JOBS_ENABLED`, `BILLING_JOBS_INTERVAL_MS` default 1h, overlap-guarded,
timer unref'd so it never holds the process open) and triggerable one by one
from `POST /jobs/:name/run` or all at once from `POST /jobs/all/run`
(SUPERADMIN/BILLING). `GET /jobs` reports each job's last run, counts and
last error.

- **trial-expiry:** `TRIAL_ENDING` reminder once per subscription when the
  trial ends within 3 days; an expired trial gets a renewal invoice due at
  the end of grace, tenant + subscription move to `PAST_DUE`, and
  `graceEndsAt` is written (`plan.graceDays` ≥ 0 wins, else the platform
  setting, else 7). Free plans (price ≤ 0) roll to `ACTIVE` with no invoice.
- **renewal-invoices:** `ACTIVE` subscriptions whose period ends within 3
  days get an invoice for the next period. A pending plan version whose
  effective date has been reached is applied first. Skipped when an `OPEN`
  invoice already covers the next period. A period already ended also moves
  the tenant to `PAST_DUE` + `graceEndsAt`. Free plans roll forward.
- **reminders:** `OPEN` invoices get one `DUE_SOON` reminder (due within 3
  days) and one `OVERDUE` reminder (past due), each once per invoice, reusing
  the invoice email template.
- **grace-suspend:** `PAST_DUE` tenants past `graceEndsAt` are suspended
  (subscription follows, suspension email sent); `SUSPENDED` tenants older
  than `BILLING_CANCEL_AFTER_DAYS` (default 30) are cancelled.
- **cancel-at-period-end:** subscriptions flagged `cancelAtPeriodEnd` whose
  period has ended are cancelled together with the tenant.

### Payment verification — `BillingService.approveProof` (rewritten)

One transaction: claim the proof (`updateMany` with a `PENDING` guard, so a
double approve is impossible), create the `Payment`, settle the invoice
(`OPEN` → `PAID` when payments + applied credit cover the total), and turn
any overpayment into an open `CreditNote` ("Overpayment on invoice …").

When the invoice is `PAID` **and** it belongs to a subscription, the
subscription is extended — the invoice's own period wins, otherwise the new
period starts at the current period end (if still in the future) or now, plus
the plan interval — and a `PAST_DUE`/`SUSPENDED`/`TRIAL` tenant is
reactivated (`graceEndsAt`/`suspendedAt` cleared, payment-approved email).
**Reactivation is gated on the subscription actually being extended:** paying
a manual invoice (no subscription) never flips a trial tenant to `ACTIVE`.
A partial payment extends nothing and sends no mail. `rejectProof` now sends
the payment-rejected email.

Duplicate detection: approving a proof whose `(methodId, transactionId)` was
already used by another `APPROVED` proof returns 409; submitting a proof with
the same pair while one is `PENDING` or `APPROVED` also returns 409 (and the
partial unique index backs both checks).

### Invoices, credit, PDF — `InvoiceService`, `InvoicePdfService`

- `createInvoice`: lines at qty × unit price (round-2), discount capped at
  the subtotal, tax from the platform tax setting unless a rate is given
  (inclusive tax adds 0), due date default +7 days, open credit applied
  automatically, audited as `billing.invoice.create`. Numbers are
  `INV-YYMM-NNNN` (month count + retries, timestamp fallback).
- `applyOpenCredit`: oldest open notes first; a note larger than the
  remaining balance applies in full and the excess returns as a new open
  credit note, so no credit is ever lost.
- `createCreditNote` settles the invoice it is applied to. An invoice paid
  purely by credit is `PAID` but does **not** extend the subscription — only
  an approved payment proof extends it.
- `InvoicePdfService` renders the invoice with pdfkit (dependency added to
  platform-api): lines, totals, credit applied, amount due, a green `PAID`
  stamp plus the payment list when paid (so the PDF doubles as a receipt),
  and the support email in the footer. Served from
  `GET /billing/invoices/:id/pdf` (console) and through the tenant backend.

### Plan changes — proration + next period + apply version

`POST /tenants/:id/change-plan` gained `effectiveAt: 'immediate' |
'next_period'` (default immediate).

- **Immediate:** a proration credit note for the unused days of the old plan
  (`round2(oldPrice × unusedDays / totalDays)`, only when the old price is
  above 0 and the period has not ended), the version switches, a new period
  starts now, and an invoice for the new plan price is issued — the proration
  credit auto-applies to it. `TRIAL` subscriptions switch version only: no
  proration, no invoice, trial dates kept.
- **Next period:** the version is recorded as pending
  (`pendingPlanVersionId` + `pendingPlanEffectiveAt` = current period end)
  and the renewal job applies it when the period turns over.
- **Apply version:** `POST /plans/:id/versions/:versionId/apply` moves every
  `TRIAL`/`ACTIVE`/`PAST_DUE` subscription on other versions of the same plan
  to the chosen version. `dryRun: true` returns the affected count + tenant
  list without changing anything. Same-plan only; archived versions refused.
- **Cancel:** `POST /tenants/:id/cancel` — `atPeriodEnd` (default true) flags
  the subscription for the cancel job; immediate cancels the subscription and
  the tenant now.

### Tenant status sync + mail + refresh

`TenantsService.updateStatus` now syncs the subscription (suspend,
past-due, reactivate, cancel) and sends the suspension email on the transition
to `SUSPENDED` and the reactivation email on `ACTIVE` from
`SUSPENDED`/`PAST_DUE`. A new global `TenantRefreshService` pushes an
entitlement refresh to the tenant backend after billing changes
(best-effort, 5s timeout). Six new mail templates: invoice, payment
approved, payment rejected, trial ending, suspension, reactivation
(production fail-closed, dev-log fallback, Dhaka dates).

### Backend — access states + tenant billing proxy

`getAccessState()` was wrong for every non-`ACTIVE` tenant: it returned
`suspended` for any status other than `ACTIVE`, so trial tenants could not
write at all and the `PAST_DUE` grace window was never honored, and it
checked American `CANCELED` while the platform enum is `CANCELLED`. Fixed:
`ACTIVE`/`TRIAL`/`PAST_DUE` reach the subscription logic; `PAST_DUE` is
`grace` while `graceEndsAt` (or the subscription `validUntil`) is in the
future, else `read_only`; `SUSPENDED`/`CANCELED`/`CANCELLED` is `suspended`;
`READ_ONLY`/`EXPIRED` is `read_only`. The platform registry response now
carries `trialEndsAt` + `graceEndsAt` so the backend can evaluate grace.

New `apps/backend/src/billing/`: `TenantBillingService` proxies the platform
internal API (`PLATFORM_API_URL` + `INTERNAL_SERVICE_SECRET`; 503 "Billing
is not configured" when unset; platform error status/message forwarded).
Endpoints are class-level `@SkipSubscription` — a suspended tenant must still
be able to pay — with the tenant id taken only from the request context:
payment methods, invoices, proof submit, invoice PDF.

### Tenant admin — billing page

`apps/admin/src/features/settings/billing/`: invoice list + detail (lines,
payments, proofs, paid/credit/remaining), proof-submit form (method with
account details, amount prefilled with the remaining balance, transaction
id, sender number, note), PDF download, paid banner, overdue badge. Route
`/mon/settings/billing`, "Billing" entry in the settings nav. The plan
page's Upgrade button now navigates to the billing page when
`VITE_BILLING_URL` is unset (previously dead).

### Platform console

- **Billing page:** new "Billing jobs" tab (status table + per-job Run +
  Run all); invoice create form (tenant, description, amount, due date);
  invoice detail shows credit applied + balance and a Download PDF button.
- **Plans page:** "Apply vN to existing subscriptions" (only when a plan
  has more than one version) → dry-run preview (affected count + tenant
  list) → Apply/Cancel.
- **Tenant detail:** change plan gained an Effective select (immediate /
  next period); new Cancel subscription action (at-period-end / immediate);
  the subscription card shows a pending plan change and cancels-at-period-end.

### Usage limits (item 6 — verified, not rebuilt)

The counters, the global `TenantLimitGuard`, `@RequiresLimit` on
product/order/upload create, the platform usage module (refresh from the
backend internal-usage endpoint + overrides), and the tenant plan page
(usage bars, warnings, Upgrade button) all already existed and were verified
against the code. Phase 7 only wired the Upgrade button to the new billing
page, closing the last gap.

## Live verification

Full lifecycle, live against platform-api :4100 + backend :4000 + SMTP
catcher (mail asserted from the captured messages), `BILLING_JOBS_ENABLED=false`
with jobs triggered through the API:

- **E2E part 1 — 56/56:** signup → verify → provision → trial (backend
  `full` access) → trial-ending reminder (once, idempotent) → trial expiry
  (invoice + `PAST_DUE` + 7d grace, invoice email) → backend `grace` access
  with writes working → partial payment (invoice stays `OPEN`, no extension,
  no mail) → duplicate transaction id 409 → reject a proof (rejected email)
  → resubmit the same transaction id (accepted — proves the full unique
  index is gone) → second half (`PAID` + extension + reactivation +
  payment-approved email) → platform + tenant-backend PDF.
- **E2E part 2 — 66/66:** renewal invoice + `PAST_DUE` (idempotent) →
  overdue reminder (once) → grace end → suspend (writes 403, reads work,
  suspension email) → reactivate by paying → overpayment credit (pay 1500
  on 1000 → 500 credit; next 400 invoice auto-paid, 100 credit remains) →
  proration (~500 credit on a mid-period 1000→2000 change, new invoice) →
  next-period change applied by renewal (v3, 3000 invoice) → apply-version
  dry-run + apply → cancel at period end (tenant stays `TRIAL` until the
  period ends, then `CANCELLED`) → audit trail (9 actions) → jobs status
  (all 5 ran, no errors).
- **Browser smoke — 18/18:** console login + invoice create form, invoice
  listed, PDF download (`%PDF-` magic, filename carries the invoice
  number), jobs table + run-all, apply-version dry-run (0 affected,
  empty state, Apply disabled, dismiss); tenant-admin owner sign-in via
  the tenant subdomain, billing page lists the smoke invoice, proof form
  renders with the amount prefilled, proof submitted through the UI
  (success toast, `PENDING` row), plan page Upgrade lands on the billing
  page.

Unit/regression: platform-api **341/341**, platform-admin **19/19**,
backend **6282 passed / 10 skipped / 0 failed** (6271 baseline + 11 new:
5 entitlement access-state cases + 6 billing proxy cases), storefront
**699/699**, shared-types **14/14**, tenant-admin **1674/1674**
(1671 baseline + 3 billing tests, 186 files, vitest browser headless;
`tsc --noEmit` clean).

## Bugs found and fixed during verification

1. **approveProof reactivated on any paid invoice** (real app bug):
   a trial tenant paying a manual "setup fee" invoice flipped to `ACTIVE`
   while its subscription stayed `TRIAL`. Fixed by gating reactivation on
   the subscription actually being extended; unit test added ("does not
   reactivate a trial tenant paying a manual invoice").
2. **E2E psql timezone** (test bug, not app): psql sessions run in
   Asia/Dhaka while the app uses UTC and the `timestamp` columns are naive,
   so a 1-hour backdate landed in the future from the app's view. E2E
   scripts now prefix `SET TIME ZONE 'UTC';`.
3. **E2E pending-plan setup** (test bug, not app): backdating
   `currentPeriodEnd` without `pendingPlanEffectiveAt` broke the renewal
   job's `pendingPlanEffectiveAt <= currentPeriodEnd` condition, and an
   unpaid change invoice correctly tripped the renewal idempotency guard.
   The script now pays the change invoice and backdates both columns.
4. **Billing controller used the retired `manager` role** (real app bug,
   caught by `role-consolidation.spec.ts` in regression): the `manager`
   role was consolidated into `employee` and removed from the `UserRole`
   enum, every `@Roles()` gate, and every frontend role list. The new
   billing controller's four read gates used `manager`; changed to
   `employee` (the consolidated role). Regression also showed the full
   backend suite must run with `DATABASE_URL`/`TENANT_DATABASE_URL` set
   to the test DB (non-superuser `ecomate_tenant_app` role) — without
   them the RLS + marketing integration specs fail on missing env, not
   on code.

## Index audit — migration `20261117002049_phase7_billing_indexes`

Per the standing indexing rule (indexes everywhere a real query benefits,
not only where strictly necessary), every Phase 7 query was checked against
the platform schema. Gaps found and fixed in the same commit:

- **Added:** `Subscription(status, trialEndsAt)` (trial-expiry job),
  `Subscription(cancelAtPeriodEnd, currentPeriodEnd)` (cancel job),
  `Invoice(subscriptionId, status, periodStart)` (renewal idempotency
  guard — Invoice had no `subscriptionId` index at all),
  `Invoice(createdAt)` (`nextInvoiceNumber` month count on every invoice
  creation), `Tenant(status, graceEndsAt)` (grace-suspend job).
- **Replaced (same leading column, strictly better):**
  `Subscription(planVersionId)` → `(planVersionId, status)` (applyVersion);
  `CreditNote(tenantId)` → `(tenantId, appliedInvoiceId, createdAt)`
  (applyOpenCredit, oldest open note first).
- **Dropped:** the `PaymentProof` full unique `(methodId, transactionId)`
  from the baseline — redundant with the Phase 7 partial unique index
  (`PENDING`/`APPROVED` only) and contradicting the intended behaviour:
  a rejected proof's transaction id must be resubmittable, but the full
  unique made resubmission die with an unhandled P2002. The partial index
  stays as the DB-level guard; E2E part 1 now proves resubmission live.
- **Verified already covered:** `Subscription(status, currentPeriodEnd)`
  (renewal), `Invoice(status, dueAt)` (reminders), `Invoice(tenantId,
  status)` (lists), `InvoiceReminder` unique `(tenantId, kind,
  referenceId)` (dedupe), `Tenant(status, createdAt)` (tenant list +
  registry), `AuditLog` tenant/action indexes.
- **Deliberately not added:** `Tenant(status, suspendedAt)` (`SUSPENDED`
  is highly selective on its own) and `Invoice(tenantId, createdAt)`
  (per-tenant invoice sets are small; the sort is trivial).

## Known limits

- No screenshot upload for proofs — `screenshotUrl` is an optional string
  only; no file storage or image handling.
- No auto-charging: every payment is a manual transfer + proof review.
- No self-service tenant plan upgrade: tenants see the billing page and can
  pay, but plan changes still go through the console (or support).
- Single-instance job runner: the interval runner has no cross-instance
  locking — do not run two platform-api instances with jobs enabled.
- Credit-paid invoices don't extend subscriptions (only approved payment
  proofs do).
- Invoice PDF is English-only.
- Reactivation happens only on subscription extension (see bug 1 above):
  paying a manual invoice never changes tenant status.
- Production signup/welcome/invoice email needs SMTP (dev logs, production
  fails closed); custom domains need real DNS + Caddy on-demand TLS.
- Signup default still follows the newest plan version unless
  `default_plan_version_id` is set explicitly (finding 6.10-F1, unchanged).
