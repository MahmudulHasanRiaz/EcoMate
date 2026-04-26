# Expenses, Customers, Issues - Action Plan

## Phase 1 - Security and Permissions
- Protect `expenses` category endpoints with `enforcePermission` for read/create/update/delete.
- Protect `issues` list/detail endpoints with `enforcePermission` for read/create/update.

## Phase 2 - Validation and Error Handling
- Validate `platform` query for expenses list (reject invalid enum values).
- Customers: handle duplicate phone (P2002) and not-found update (P2025) with clear responses.
- Customers: avoid wiping fields on partial update (only update provided fields).
- Issues: validate status/priority inputs and resolve `updatedBy`/`createdBy` fallback to `System`.
- Services: use `handleApiResponse` and throw on non-OK for expenses/issues to surface errors in UI.
- Customers SWR fetcher: check `res.ok` and surface errors; toast on failure.

## Phase 3 - Performance and Payload
- Customers list: replace per-row order aggregate with batched `groupBy` totals by phone.
- Issues list: stop eager loading logs in list query (return `logs: []` for list rows).
- Expenses UI: pass date/category filters to server to reduce payload.

## Phase 4 - UX and Data Polish
- Replace garbled currency symbol in expenses/customers screens with ASCII-safe prefix.
- Customer details: handle missing email (hide mail link when absent).
