# Verification Matrix (Project-Agnostic)

Default policy: do not run verification commands unless the Architect/CTO or user explicitly asks. When not asked, propose the exact commands and explain what each one proves.

This file is intentionally **project-agnostic**. Fill in the project’s commands once and reuse them.

## Project Commands (Fill In)
- Typecheck: `<typecheck_cmd>`
- Lint: `<lint_cmd>`
- Unit tests: `<unit_test_cmd>`
- Integration tests: `<integration_test_cmd>`
- E2E tests: `<e2e_test_cmd>`
- Build: `<build_cmd>`
- Dev server: `<dev_cmd>`

## What to Verify (By Change Type)

### UI-only changes
- Lint + typecheck (if applicable)
- Build (if applicable)
- Smoke test the affected screens (loading/empty/error states)

### API/backend changes
- Lint + typecheck
- Unit/integration tests for the changed endpoints/services
- Smoke test key endpoints and permission checks
- Validate error responses are user-friendly and contract-consistent

### Database/schema changes
- Follow `agents/direction/db-playbook.md` (migration generation is required)
- Apply migration in a safe environment
- Smoke test the affected flows

### Background job/worker changes
- Lint + typecheck
- Unit tests for job handlers (if present)
- Validate idempotency/retry safety and payload compatibility

### Dependency/config changes
- Build + smoke test
- Confirm env/config keys are documented and backward compatible

