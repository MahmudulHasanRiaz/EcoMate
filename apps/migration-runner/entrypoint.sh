#!/bin/sh
# Phase 3 migration runner — runs the Phase 2 central-auth scripts 01 -> 02
# -> 03 IN ORDER and exits. This is a one-off job, not a service.
#
# Usage (inside the migration-runner image; WORKDIR is /app/apps/auth-service):
#   entrypoint.sh [--apply] [--dry-run] [--out <dir>]
#   entrypoint.sh --help
#
# Modes:
#   default / --dry-run : dry-run — the scripts' default; NOTHING is written.
#   --apply             : writes to the central DB (script 01) and, for script
#                         03 only, back into the tenant DBs (the one source
#                         mutation in Phase 2).
#   --out <dir>         : where the reconcile reports + mapping file go.
#                         Default: $MIGRATION_OUT_DIR or /app/out (writable by
#                         the non-root runtime user; mount a volume there to
#                         collect the reports on the host).
#
# Behaviour:
#   - Fails fast if any of TENANT_DATABASE_URL / PLATFORM_DATABASE_URL /
#     AUTH_DB_URL is unset (the scripts would throw the same error).
#   - Runs 01, then 02, then 03. Stops at the FIRST failure — later scripts
#     depend on the earlier ones (03 resolves central ids script 01 created)
#     — and exits NON-ZERO.
#   - After each script, prints its reconcile summary file
#     (<out>/<base>.summary.txt) to stdout. If a script crashes before
#     writing its report, no summary file exists and that is said plainly;
#     the script's own "[<script>] FAILED:" line on stderr is the diagnosis.
#   - Script 04 (04-migrate-presets.ts) is deliberately NOT run here: it is
#     not part of the 01 -> 03 live run.
#   - Script 01 writes migration-mapping.json into the out dir, but ONLY on
#     --apply (dry-run ids are not stable). Script 03 never reads that file:
#     it resolves central ids by email lookup in the central user table.
set -eu

usage() {
  echo "Usage: $0 [--apply] [--dry-run] [--out <dir>] [--help]"
  echo "  Default is dry-run (nothing is written). --apply writes."
  echo "  Reports go to --out (default: \$MIGRATION_OUT_DIR or /app/out)."
}

APPLY=0
OUT_DIR="${MIGRATION_OUT_DIR:-/app/out}"

while [ $# -gt 0 ]; do
  case "$1" in
    --apply)
      APPLY=1; shift ;;
    --dry-run)
      APPLY=0; shift ;;
    --out)
      if [ $# -lt 2 ]; then echo "error: --out needs a directory" >&2; exit 2; fi
      OUT_DIR="$2"; shift 2 ;;
    --out=*)
      OUT_DIR="${1#--out=}"; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "error: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$APPLY" -eq 1 ]; then MODE="apply"; else MODE="dry-run"; fi

# ---- Pre-flight: required env (the scripts check this too, via
# loadMigrationEnv, but failing here names all three at once) ----
MISSING=""
for var in TENANT_DATABASE_URL PLATFORM_DATABASE_URL AUTH_DB_URL; do
  if [ -z "$(printenv "$var" 2>/dev/null || true)" ]; then
    MISSING="$MISSING $var"
  fi
done
if [ -n "$MISSING" ]; then
  echo "[migration-runner] ERROR: missing required env:$MISSING" >&2
  exit 2
fi

# ---- Optional-env notes (warnings only — the scripts handle absence) ----
if [ -z "$(printenv APP_ENCRYPTION_KEY 2>/dev/null || true)" ] || \
   [ -z "$(printenv BETTER_AUTH_SECRET 2>/dev/null || true)" ]; then
  echo "[migration-runner] WARNING: APP_ENCRYPTION_KEY and/or BETTER_AUTH_SECRET unset —"
  echo "  script 02 will migrate operators WITHOUT their TOTP rows (per-user"
  echo "  'totp_fallback_reenrol' exceptions; re-enrolment at next login)."
fi
if [ -z "$(printenv AUTH_SERVICE_URL 2>/dev/null || true)" ] || \
   [ -z "$(printenv INTERNAL_SERVICE_SECRET 2>/dev/null || true)" ]; then
  echo "[migration-runner] NOTE: AUTH_SERVICE_URL / INTERNAL_SERVICE_SECRET unset —"
  echo "  script 02 role-sync falls back to direct Prisma writes (same effect,"
  echo "  recorded as 'role_sync_method: direct', no audit event)."
fi

mkdir -p "$OUT_DIR"
echo "[migration-runner] mode=$MODE out=$OUT_DIR"
echo "[migration-runner] running 01 -> 02 -> 03 (stops at first failure)"

# Script flags: --out always (absolute, so it is independent of cwd);
# --apply only in apply mode. "$@" inside run_script is these flags.
set -- --out "$OUT_DIR"
if [ "$APPLY" -eq 1 ]; then set -- "$@" --apply; fi

run_script() {
  script_file="$1"; summary_file="$2"; shift 2
  echo "--- [$script_file] mode=$MODE ---"
  if npx tsx "scripts/$script_file" "$@"; then
    rc=0
  else
    rc=$?
  fi
  if [ -f "$summary_file" ]; then
    echo "--- reconcile summary: $summary_file ---"
    cat "$summary_file"
  else
    echo "[migration-runner] WARNING: no summary file at $summary_file"
    echo "  (the script failed before writing its report — see its FAILED line above)"
  fi
  return "$rc"
}

if ! run_script "01-migrate-tenant-users.ts" "$OUT_DIR/tenant-users.summary.txt" "$@"; then
  echo "[migration-runner] FAILED at 01-migrate-tenant-users — stopping; 02/03 NOT run." >&2
  exit 1
fi
if ! run_script "02-migrate-operators.ts" "$OUT_DIR/operators.summary.txt" "$@"; then
  echo "[migration-runner] FAILED at 02-migrate-operators — stopping; 03 NOT run." >&2
  exit 1
fi
if ! run_script "03-link-back.ts" "$OUT_DIR/link-back.summary.txt" "$@"; then
  echo "[migration-runner] FAILED at 03-link-back." >&2
  exit 1
fi

echo "[migration-runner] ALL DONE — 01, 02, 03 succeeded (mode=$MODE)."
echo "[migration-runner] reports in $OUT_DIR:"
ls -1 "$OUT_DIR"
exit 0
