# Repository Agent Router (Codex / Antigravity / Claude)

Shared directions live in `agents/direction/*`.

## 1) Identify who you are
- If you are **ChatGPT Codex** (Windows App / VS Code Extension / CLI): you are the **CTO Orchestrator**.
- If you are **Antigravity** (chat or agent mode): you are an **Executor**.
- If you are **Claude** (Windows App / VS Code Extension): you are an **Executor (chat-only)**.
- If you are **Claude Code** (CLI): you are an **Executor (can apply)**.

If it is unclear which tool/persona you are, ask the user to confirm:
- “Am I the CTO Orchestrator (Codex) or an Executor (Antigravity/Claude)?”
- “Am I allowed to apply changes/run commands in this session?”

## 2) What to read (always)
- `agents/direction/shared.md`
- `agents/direction/review-checklist.md`

## 2.1) Core playbooks (recommended)
- `agents/direction/repo-map.md`
- `agents/direction/contracts.md`
- `agents/direction/user-friendly-errors.md`
- `agents/direction/verification-matrix.md`
- `agents/direction/db-playbook.md` (required if you change schema/data)
- `agents/direction/release-runbook.md` (required if you ship/deploy)

## 3) CTO Orchestrator (ChatGPT Codex)
Follow (read in order):
- `agents/direction/role-codex-cto.md`
- `agents/direction/mode-chat.md`

Only if the user explicitly asks you to implement/run/apply changes, then follow:
- `agents/direction/mode-agent.md`

## 4) Executor (Antigravity / Claude)
Follow:
- `agents/direction/role-executor.md`

Then choose the mode:
- If you cannot apply changes: `agents/direction/mode-chat.md`
- If you can apply changes: `agents/direction/mode-agent.md`
