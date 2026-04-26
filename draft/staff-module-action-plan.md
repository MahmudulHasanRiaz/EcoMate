# Staff Module Action Plan

Goal: secure the staff module, remove mock/demo coupling, stabilize API behavior, and keep UI behavior consistent with real data.

## Phase 0 - Confirm Policy (blocking)
- Confirm who is allowed to manage staff:
  - Suggested: `staff` permission gate (create/read/update/delete), Admin/Manager always allowed.
  - Confirm whether non-privileged users can view their own staff record.
- Decide whether demo seeding is allowed only in dev or removed entirely.
- Decide whether `phone` can be optional (current Prisma schema requires unique phone).

## Phase 1 - Security & Access Control (critical)
- Add auth + permission gating to all staff endpoints:
  - `GET/POST /api/staff`
  - `GET/PUT/DELETE /api/staff/[id]`
  - `POST /api/staff/invite`
  - `POST /api/staff/[id]/payments`
  - `GET /api/staff/clerk/[clerkId]`
- Use a single permission helper (existing `enforcePermission` if available) to avoid drift.
- Limit reads: non-admins can only access their own staff record.
- Ensure invite creation requires proper permission and business access.

## Phase 2 - Remove Mock/Seed Coupling (critical)
- Replace placeholder-based logic in `src/services/staff.ts`:
  - Remove `seedDemoStaffIntoDb` and placeholder fallback paths.
  - Fetch staff data via API only (client + server).
- Remove demo-derived calculations in `calculateStaffMemberDetails` if not backed by DB data.
- Ensure `getCurrentStaff` uses a real endpoint or remove it if unused.

## Phase 3 - Payments & Financials (critical)
- Make `makePayment` call `/api/staff/[id]/payments` instead of mock updates.
- Server-side: after payment, return updated staff totals (totalPaid/dueAmount) to UI.
- Ensure staff payment history is persisted and reflected in both staff list and detail pages.
- Verify salary/commission normalization is applied consistently for UI + API.

## Phase 4 - Data Integrity & Auth Sync (high)
- Fix `staff-auth`:
  - Remove "invite -> Admin" auto-escalation.
  - Ensure phone collisions don’t upsert with empty string.
  - Update `lastLogin` on each auth session.
- Ensure Clerk metadata sync is safe and doesn’t overwrite DB-only fields.

## Phase 5 - Performance & Scalability (medium)
- Add pagination to `/api/staff` to prevent large payloads.
- Make avatar fetch resilient:
  - Batch + paginate Clerk lookups or lazy-load in UI.
  - Never block the main list on avatar calls.
- Add request validation on PUT/POST to return structured 4xx errors.

## Phase 6 - UX & Error Handling (medium/low)
- Add error state + retry to staff list/detail pages.
- Fix currency glyph corruption (replace the stray "…\u00153" sequences).
- Ensure staff detail page doesn’t hang if any fetch fails.

## Tests / Verification
- Permissions: verify staff APIs return 401/403 properly for non-privileged users.
- Create/Edit/Delete staff: confirm DB changes and Clerk updates.
- Invite flow: invite -> accept -> staff record auto-links.
- Payments: record shows in history; due amount decreases.
- Pagination: staff list loads page-by-page without UI glitches.

## Notes
- If you want demo data in dev only, gate with `NODE_ENV !== 'production'`.
- If phone must be optional, schema change required; else enforce phone on invite/create.
