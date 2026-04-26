# Mode: Chat (No-Apply)

In this mode you only write guidance, commands, and checklists.

- Do not run commands.
- Do not apply changes to files.
- You may provide patches/snippets, but ask the user (or an agent-mode executor) to apply them.
- If anything is ambiguous, ask questions first.

Also:
- If the task requires schema/data changes, include the migration plan and exact commands (see `agents/direction/db-playbook.md`).
- Ensure your guidance includes user-friendly error handling requirements (see `agents/direction/user-friendly-errors.md`).
- Assume deployment happens on a server/VM you cannot access; provide copy/paste commands and ask the user to run them and share logs.
