# User-Friendly Error Handling (Mandatory)

Goal: end users should never be blocked by cryptic errors. They should see a clear message and the next action, while developers get full details in logs.

## Principles
- Users get a helpful, non-technical message.
- Developers get the technical context in logs/telemetry.
- Do not leak internal stack traces, secrets, SQL, or PII to the user.
- Prefer recoverable UX (retry, back, contact support) over dead ends.

## UI Requirements (If Applicable)
- Every screen/flow must handle:
  - loading state
  - empty state
  - error state
- Provide a “Retry” action where safe.
- For forms:
  - show field-level validation messages
  - preserve user input on error
- Avoid infinite spinners: time out and show a message.

## API Requirements (If Applicable)
- Use consistent error responses across the API (follow existing conventions; if none exist, propose one and get approval).
- Map errors to clear categories:
  - validation (400)
  - authentication (401)
  - authorization (403)
  - not found (404)
  - conflict (409)
  - rate limit (429)
  - unexpected (500)
- Return a stable error code (machine-readable) and a safe user message.
- Log the full error with context (request id, user id, route, key parameters), but avoid logging secrets.

## CTO Orchestrator Review Checks
- Is the user-facing error message clear and actionable?
- Is the internal log message sufficient to debug?
- Are errors consistent with the system’s contract conventions?

