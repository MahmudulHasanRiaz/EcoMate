# Review & Verification Checklist

## Before Applying / Reviewing
- Is the goal/acceptance criteria clear?
- Is the scope (which files/which behavior) explicit?
- Are impacted contracts identified (see `agents/direction/contracts.md`)?

## After Changes
- Is `git status` clean/expected?
- Does `git diff` contain any unnecessary changes?
- Are user-facing errors user-friendly and consistent (see `agents/direction/user-friendly-errors.md`)?
- If schema/data models changed: are migration artifacts present and correct (see `agents/direction/db-playbook.md`)?

## Quality Gates (as applicable)
- Typecheck: `<typecheck_cmd>`
- Lint: `<lint_cmd>`
- Tests: `<test_cmd>`
- Build: `<build_cmd>`

Examples (replace with your repo’s commands):
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

## Runtime Sanity (if needed)
- Core-flow smoke tests (login, critical page, critical API)
- Check error logs and key edge cases
