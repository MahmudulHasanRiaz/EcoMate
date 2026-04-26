# /agents

This folder stores agent **profiles** (entrypoints) and shared **directions**.

- Profiles: `agents/*`
- Shared directions: `agents/direction/*`

Tool mapping (our setup):
- ChatGPT Codex (Windows App / VS Code Extension / CLI): `agents/AGENTS.md`
- Antigravity (chat + agent mode): `agents/AGENTS.md`
- Claude Code (CLI, can apply): `agents/claude-code.md`
- Claude (Windows App / VS Code Extension, chat-only): `agents/claude-extension.md`

Root stubs for tools that only read fixed filenames:
- `AGENTS.md` → `agents/AGENTS.md`
- `CLAUDE.md` → router → `agents/claude-code.md` / `agents/claude-extension.md`
