# Contracts (Do-Not-Break Interfaces)

A “contract” is anything other code or end users depend on. Breaking contracts creates hidden conflicts across the system.

## What Counts as a Contract
- Public API endpoints (paths, methods, query/body params, response shape).
- Error shapes and error codes.
- Authorization semantics (roles/permissions meaning and enforcement points).
- Database invariants (unique constraints, required fields, enums, data meaning).
- Background job names, payload schemas, and retry/idempotency behavior.
- Events/webhooks payloads, signatures, and delivery expectations.
- URLs/routes used in emails/SMS/links.
- Configuration keys / environment variables.
- File formats (CSV exports/imports) and column meanings.

## Rules
- Prefer **additive** changes (add fields, add endpoints, add enums) over breaking changes.
- If a breaking change is required, propose a migration/deprecation plan and get explicit approval first.
- Keep a **single source of truth** for business rules (avoid duplicating logic across layers).
- When you change a contract, update:
  - Types/schemas in code
  - All call sites
  - Tests (or add tests)
  - Documentation/runbooks

## Contract Change Protocol (CTO Orchestrator)
1) Identify the contract(s) impacted.
2) Propose options (including a backward-compatible plan if possible).
3) Ask for explicit approval if breaking or risky.
4) Implement with clear acceptance criteria.
5) Verify and document the change.

