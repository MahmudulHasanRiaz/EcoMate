# Shared Directions (All Agents)

## 0) Language Policy
- User-facing explanations: **Bangla**, but keep developer/technical terms in **English**.
- Any runnable **commands/prompts** that the user should copy/paste must be written in **English**.
- Switch to English replies only if the user explicitly requests: “reply in English”.

## 1) Tone & Output
- Professional, concise, and to the point.
- No entertainment/filler text.
- Make **commands / file paths / actions** explicit.

## 2) Requirements Questions (When to ask)
- If anything is ambiguous/uncertain: ask first (do not assume).
- Use 1–5 concise questions to clarify requirements.
- When options exist, offer 2–3 options with pros/cons and ask the user to choose.

## 3) Defaults (No assumptions)
- Do not do things the user did not ask for.
- If you must assume, explicitly confirm the assumption first.

## 4) Safety
- Never reveal secrets/tokens/keys/passwords.
- No destructive actions (delete/migrate/prod ops) unless the user explicitly asks.

## 5) Optional Improvements (Approval-Gated)
- If you notice a meaningful improvement opportunity (performance, reliability, security, DX, tests), propose it as an **optional** item with:
  - benefit, cost, and risk
  - what would change (scope)
  - how to verify success
- Do not implement optional improvements until the user/CTO explicitly approves.

## 6) User-Friendly Errors (Mandatory)
- Every change that affects user-facing flows must include user-friendly error handling:
  - clear, actionable messages for end users
  - consistent API/UI error behavior
  - no internal stack traces or sensitive details shown to users
- Follow `agents/direction/user-friendly-errors.md`.

## 7) Schema/Data Changes (Migration-Required)
- If you change database schema/models, you must:
  - generate and commit migration artifacts
  - ensure code + schema + data are compatible
  - avoid breaking production data unexpectedly
- Follow `agents/direction/db-playbook.md`.

## 8) Local Machine vs Deployment Environment (Important)
- Assume the files you can see/edit and the commands you can run are on the **user’s local machine**.
- Assume the production/staging deployment will happen on a **separate VM/server** that you cannot access directly.
- Therefore:
  - Do as much as possible locally (code changes, local verification, producing exact commands).
  - Do **not** perform `git commit`, `git push`, or any deploy action by default.
  - Provide copy/paste commands for the user to run on their VM/server, and ask them to paste back logs/output if something fails.
  - If a deployment-only issue occurs, diagnose from the user-provided logs and propose the next safe step; the user executes it.
