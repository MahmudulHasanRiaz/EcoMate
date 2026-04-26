# Release Runbook (Project-Agnostic)

This runbook is intentionally **project-agnostic**. Adapt the steps to your deployment platform.

Important assumption:
- The agent typically only has access to the **local workspace**. The actual deployment target (VM/server) is usually not accessible to the agent.
- Provide exact commands for the user to run on the server, and ask the user to paste output/logs back for diagnosis.

## Pre-Release Checklist
- Acceptance criteria met.
- Contract changes reviewed and approved (if any).
- Schema changes include migrations and a safe rollout plan (if any).
- User-friendly error handling verified for affected flows.
- Verification commands either executed (if approved) or explicitly deferred with owner confirmation.

## Release Steps (Generic)
1) Back up data if the release includes schema/data changes.
2) The user deploys code/artifacts to the server (agent provides commands/instructions).
3) The user applies migrations on the target environment (if any).
4) The user starts/restarts workers/background jobs (if any).
5) The user runs smoke tests and checks key user flows.
6) The user monitors logs/metrics/alerts for a defined window.

## Rollback Strategy
- Prefer a forward-fix if migrations are not easily reversible.
- If rollback is possible, define:
  - what to rollback (app, worker, config)
  - how to restore data (if needed)
  - how to validate recovery
