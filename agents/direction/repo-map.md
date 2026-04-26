# Repo Map (Project-Agnostic Template)

Purpose: give any agent a fast “where do I edit X?” map so changes land in the correct layer and do not create system conflicts.

This file is intentionally **project-agnostic**. Fill in the placeholders for each repo you copy this into.

## 1) High-Level Architecture (Fill In)
- UI / Frontend:
- API / Backend:
- Domain / Business logic:
- Data access / ORM:
- Background jobs / workers / cron:
- AuthN (authentication):
- AuthZ (authorization: roles/permissions):
- Integrations (3rd-party APIs):
- Ops / Deploy / Infra:

## 2) Key Entrypoints (Fill In)
- Local dev command:
- Local dev URL/port:
- Build command:
- Lint command:
- Typecheck command:
- Test command(s):
- Worker/cron command(s):
- Seed/bootstrap command(s) (if any):

## 3) “Where Do I Change X?” (Fill In)
- Add a new screen/page/view:
- Add/modify an API endpoint:
- Add/modify business rules:
- Add/modify a database table/column:
- Add/modify permissions/roles:
- Add/modify a background job:
- Add/modify an integration:
- Add/modify config/env:

## 4) File/Folder Boundaries (Rules)
Write the rules that prevent accidental coupling:
- UI must not contain business logic beyond simple presentation.
- API routes/controllers should remain thin and call domain services.
- Domain services own business invariants and validations.
- Data layer owns query composition, transactions, and migrations.
- Background jobs must be idempotent and safe to retry.

## 5) Conventions (Fill In)
- Error handling conventions:
- API success/error envelope:
- Logging conventions (tags, correlation ids):
- Naming conventions:
- Code formatting rules:

