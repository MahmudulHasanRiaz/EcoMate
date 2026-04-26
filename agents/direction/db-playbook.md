# Database & Schema Changes (Migration-Required Playbook)

This playbook is intentionally **project-agnostic**. Use the repo’s migration tool and standards.

## Non-Negotiables
- Any schema change must include a migration (generated and committed).
- Schema changes must not leave the system in a half-updated state (code + schema + data must match).
- If you cannot generate/apply a migration due to missing DB access or permissions, stop and ask the user for what you need.

## Safe Change Strategy
- Prefer additive, backward-compatible changes:
  - add nullable columns first
  - backfill data
  - switch reads/writes
  - make column required later (if needed)
- Avoid long locks on large tables; consider multi-step migrations.
- Consider indexes for new query patterns.

## Migration Workflow (Generic)
1) Update schema/model definitions.
2) Generate migration artifacts using the project’s migration tool.
3) Review the generated SQL/DDL for safety and correctness.
4) Apply migrations in the target environment (dev/stage/prod as appropriate).
5) Run a minimal smoke test for the impacted flows.
6) Update docs/runbooks if operations change.

Notes:
- Applying migrations to **production** is a high-impact operation and must be explicitly approved by the user.
- Applying migrations to local/dev/stage environments is usually part of implementation, but still requires access to the target database.
- In most setups, the agent cannot access the deployment VM/server database directly; the user runs the final deploy/migration commands and shares logs if issues occur.

## Example: Prisma Migrate (Only If Your Repo Uses Prisma)
- Generate migration: `npx prisma migrate dev --name <short_descriptive_name>`
- Apply in production: `npx prisma migrate deploy`
- Regenerate client: `npx prisma generate`

## Backfill & Data Fixes
- If new fields need data, prefer explicit backfill scripts/jobs over “magic defaults”.
- Backfills should be resumable, observable, and safe to retry.

## Rollback
- Assume rollbacks may be limited. Prefer a forward-fix plan and backups.
- For risky migrations, propose a rollout window and rollback steps before applying.
