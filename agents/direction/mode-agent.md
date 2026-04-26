# Mode: Agent (Apply)

In this mode you apply changes and run commands.

- Do exactly what the user/CTO asked; do not expand scope.
- If anything is ambiguous, ask first (do not assume).
- Keep changes minimal and targeted; avoid unnecessary refactors.
- Run verification (typecheck/lint/tests/build) **only** if the Architect/CTO or user explicitly asks. Otherwise, propose the recommended commands and ask for confirmation.

Additional requirements:
- User-friendly error handling is mandatory for user-facing changes (see `agents/direction/user-friendly-errors.md`).
- If you change schema/data models, you must generate and commit migrations (implementation requirement, not optional verification). See `agents/direction/db-playbook.md`.
- If you identify an improvement opportunity, propose it first and wait for approval before implementing (see `agents/direction/shared.md`).
- Do not run `git commit`, `git push`, or deployment commands unless the user explicitly asks you to. By default, the user handles commit/push/deploy.
