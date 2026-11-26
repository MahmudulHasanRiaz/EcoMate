# migration-runner

One-off container that runs the Phase 2 central-auth data-migration scripts
`01-migrate-tenant-users` → `02-migrate-operators` → `03-link-back`, in
order, and exits. It is **not a service**: no port, no healthcheck, no
long-running process.

## Why this image exists

The Phase 3 deploy stopped at Step 2 because no container on staging has
the monorepo layout plus the generated Prisma clients the scripts need.
This image is that shell: the Phase 2 scripts plus all three generated
Prisma clients, built from the repo root like every other service image.

## Layout decision — scripts stay in place

The scripts live at `apps/auth-service/scripts/` and are copied into the
image **at that same path, unchanged**. The reason is
`scripts/lib/clients.ts`, which imports the generated clients by relative
paths that assume that location:

| Import in `scripts/lib/clients.ts` | Resolves to in this image |
|---|---|
| `@prisma/client` | tenant client — root `node_modules/.prisma/client`, generated from `apps/backend/prisma/schema.prisma` (default generator output; the `@prisma/client` stub re-exports `.prisma/client/default`) |
| `../../../platform-api/src/generated/prisma/index.js` | `apps/platform-api/src/generated/prisma`, generated from `apps/platform-api/prisma/schema.prisma` (`output = "../src/generated/prisma"`) |
| `../../src/generated/prisma/index.js` | `apps/auth-service/src/generated/prisma`, generated from `apps/auth-service/prisma/schema.prisma` (`output = "../src/generated/prisma"`) |

Relocating the scripts would have meant editing `clients.ts` — verified
Phase 2 code — for no benefit. Preserving the layout keeps the scripts'
documented invocation (`npx tsx scripts/01-...ts` from `apps/auth-service`)
working verbatim.

## What is in the image

- `apps/auth-service/scripts/` — the Phase 2 scripts, unchanged (including
  `04-migrate-presets.ts`, which the entrypoint deliberately does **not**
  run: it is not part of the 01 → 03 live run).
- The three generated Prisma clients (see table above).
- Runtime deps only: `better-auth` 1.7.28 (exact — script 02 imports
  `better-auth/crypto`), `pg`, `@prisma/adapter-pg`, `@prisma/client`,
  `prisma` (build-time generate; rides along in `node_modules`), `tsx`
  (runs the `.ts` scripts). Deliberately **not** included: `bcryptjs`,
  `nodemailer`, `@better-auth/prisma-adapter` — no script imports them.
- No schemas, migrations, or app source: generation happens in the builder;
  the runtime only needs the generated clients.

## Build

From the repo root (same contract as every service image — context `.`,
file `apps/migration-runner/Dockerfile`, `linux/amd64`):

```sh
docker build -f apps/migration-runner/Dockerfile -t ecomate-saas-migration-runner .
```

Or via the reusable CI workflow (`.github/workflows/build-service-image.yml`)
with `service: migration-runner` — note the dispatch form in `ci.yml` has
no `migration-runner` toggle yet; that wiring is a follow-up for the
coordinator, not part of this app.

## Run

Prerequisite (Phase 3 Step 4, before this image): `ecomate_auth` must exist
with its tables (`prisma migrate deploy` against `AUTH_DB_URL`) — the
scripts connect to an empty database otherwise and fail.

Dry-run first (the default — nothing is written):

```sh
docker run --rm \
  -e TENANT_DATABASE_URL='postgresql://...' \
  -e PLATFORM_DATABASE_URL='postgresql://...' \
  -e AUTH_DB_URL='postgresql://...' \
  -v migration-reports:/app/out \
  ecomate-saas-migration-runner
```

Then the live run (same command plus `--apply`):

```sh
docker run --rm \
  -e TENANT_DATABASE_URL='postgresql://...' \
  -e PLATFORM_DATABASE_URL='postgresql://...' \
  -e AUTH_DB_URL='postgresql://...' \
  -e APP_ENCRYPTION_KEY='<64-hex>' \
  -e BETTER_AUTH_SECRET='...' \
  -v migration-reports:/app/out \
  ecomate-saas-migration-runner --apply
```

Environment variables:

| Variable | Required | Notes |
|---|---|---|
| `TENANT_DATABASE_URL` | yes | Tenant DB (source reads; script 03 writes link-back ids here) |
| `PLATFORM_DATABASE_URL` | yes | Platform DB (source reads) |
| `AUTH_DB_URL` | yes | Central `ecomate_auth` (target; must already be migrated) |
| `APP_ENCRYPTION_KEY` | no* | 64-hex AES key for platform `enc:v1:` TOTP secrets (script 02). Without it, operators migrate without TOTP rows (`totp_fallback_reenrol`). |
| `BETTER_AUTH_SECRET` | no* | Key for `better-auth/crypto` `symmetricEncrypt` of migrated TOTP secrets (script 02). Same fallback as above. |
| `AUTH_ORG_LIMIT` | no | Org limit, default 5, clamped [1, 1000] |
| `AUTH_SERVICE_URL` + `INTERNAL_SERVICE_SECRET` | no | Script 02 role-sync via the auth service; without them it writes the same two fields directly via Prisma (`role_sync_method: direct`). |
| `MIGRATION_OUT_DIR` | no | Report directory inside the container (default `/app/out`) |

The entrypoint also accepts `--out <dir>` to override the report directory
and `--dry-run` to force dry-run mode.

## Output

Each script writes `<base>.json` + `<base>.summary.txt` into the out dir
(`tenant-users`, `operators`, `link-back`); the entrypoint prints each
`.summary.txt` to stdout as the run proceeds. Script 01 also writes
`migration-mapping.json` into the out dir, but **only on `--apply`**.
The container exits `0` only if all three scripts succeed; it stops at the
first failure and exits non-zero (later scripts are not run).

## What this image does NOT do

- No `prisma migrate deploy` — Step 4 runs that (separately) before this.
- No script 04 (presets) — separate step, not part of the 01 → 03 run.
- No writes except: script 01/02 write only to `ecomate_auth`; script 03
  is the only source mutation (link-back ids into the tenant DBs).
