# Runbook 3 — Tenant suspension (wrongful, disputed, or requested)

**Severity:** P1 for the tenant (their store is read-only); P0 if many
tenants suspend at once — that suggests a job misfire, see Escalation.

## Symptoms

- Tenant reports store/admin down; console shows `SUSPENDED`.
- Backend access state `suspended`: reads work, writes return 403.
- Tenant disputes the suspension, or asks to be suspended (e.g. closing
  the shop temporarily).

## Background

Suspension happens two ways:

1. **Automatic:** the `grace-suspend` billing job suspends a `PAST_DUE`
   tenant after `graceEndsAt` passes with an unpaid invoice. After
   `BILLING_CANCEL_AFTER_DAYS` (default 30) suspended, the same job
   cancels the tenant.
2. **Manual:** an operator sets the status in the console
   (`PATCH /tenants/:id/status` → `SUSPENDED`).

Reactivation rules (Phase 7, verified live):

- Approving a payment proof **extends the subscription and reactivates**
  the tenant — but only when the approval actually extends the
  subscription. Approving a proof against a **manual invoice alone does
  NOT reactivate**; the tenant stays suspended until a subscription
  extension happens.
- Operator reactivation via the console moves the tenant status and syncs
  the subscription together, and sends a reactivation email.

**Never reactivate by editing the tenant DB directly** — the subscription
and entitlements must move together, or the tenant ends up in an
inconsistent state (active tenant, expired subscription).

## Diagnosis

1. **Console tenant detail + audit log:** who/what suspended it?
   - Audit action `billing.job.*` / grace-suspend job → automatic, after
     `graceEndsAt`.
   - `tenant.status.update` with an actor → manual; the audit row records
     who and why.
2. **Billing state:** check the tenant's `Subscription` and open
   `Invoice` rows — is there an unpaid renewal invoice? What is
   `graceEndsAt` / `suspendedAt`? Is `BILLING_CANCEL_AFTER_DAYS`
   cancellation approaching?

   ```sql
   SET TIME ZONE 'UTC';
   SELECT id, status, "trialEndsAt", "graceEndsAt", "suspendedAt"
     FROM "Tenant" WHERE slug = '<slug>';
   SELECT id, status, number, total, "dueAt" FROM "Invoice"
    WHERE "tenantId" = '<tenant-id>' AND status = 'OPEN'
    ORDER BY "createdAt" DESC;
   ```

3. **Access state:** confirm the backend view matches the platform view
   (registry sync is 60 s; allow the window before concluding a mismatch).

## Fix

- **Payment was made:** approve the proof in the console — approval
  extends the subscription and reactivates (see the rule above). If the
  proof was against a manual invoice only, also apply a plan/period change
  or operator reactivation so the subscription extends.
- **Wrongful suspension:** operator reactivate via the console
  (`PATCH /tenants/:id/status` → `ACTIVE`). This syncs the subscription
  and sends the reactivation email. Then push an entitlement refresh so
  the backend picks it up immediately instead of waiting for the 60 s
  poll:

  ```bash
  curl -s -X POST -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"tenantId":"<tenant-id>"}' "$BACKEND/entitlements/refresh"
  ```

  (The platform also pushes a refresh automatically after billing and
  override changes; the manual call is the fallback when the push fails.
  If the push fails, allow up to 60 s for the registry poll.)

- **Tenant-requested suspension:** set `SUSPENDED` via the console with a
  reason. Note the 30-day auto-cancel clock starts at `suspendedAt` — tell
  the tenant, and diary a check before it fires if the suspension is meant
  to be longer.

## Verify

- Tenant status `ACTIVE` (or `TRIAL`) in the console; subscription status
  and `currentPeriodEnd` consistent.
- Tenant admin login works and a write succeeds (e.g. save a setting);
  storefront checkout works.
- Audit log shows the reactivation with the correct actor and reason.

## Escalation

- Suspension caused by a **platform bug** (e.g. a job misfiring): freeze
  the `grace-suspend` job (manual runs only — set
  `BILLING_JOBS_ENABLED=false` and trigger other jobs manually), fix the
  bug, then re-run. Do not bulk-reactivate until the cause is fixed.
- **Mass suspensions** = incident: notify Boss before bulk-reactivating
  anyone.
- A tenant suspended by mistake who lost sales: note it in the audit trail
  and escalate to Boss — compensation is a business decision, not an
  operator one.
