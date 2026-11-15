# Tenant test database (isolated)

The backend test suite can run against a disposable PostgreSQL 16 cluster with the
tenant baseline + RLS migrations applied. This never touches the developer database.

```bash
PGBIN=/opt/homebrew/opt/postgresql@16/bin
export PGDATA="$COMMANDCODE_SCRATCHPAD/pgdata"
SOCK=/tmp/ecomate-pg-55432
mkdir -p "$SOCK"

# 1. Init + start (one-time; use a short socket path — PG unix socket paths are <104 bytes)
"$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust --no-locale -E UTF8
LC_ALL=C LANG=C "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" \
  -o "-p 55432 -c listen_addresses=127.0.0.1 -k $SOCK" start

# 2. Create + migrate a fresh tenant database
"$PGBIN/createdb" -h 127.0.0.1 -p 55432 -U postgres ecomate_tenant_test
cd apps/backend
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/ecomate_tenant_test \
  npx prisma migrate deploy

# 3. Run the suite (RLS uses the default tenant GUC)
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/ecomate_tenant_test \
TENANT_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/ecomate_tenant_test \
DEFAULT_TENANT_ID=00000000-0000-4000-8000-000000000000 \
npm test -- --runInBand

# 4. Stop when done
"$PGBIN/pg_ctl" -D "$PGDATA" stop -m fast
```

The two real-DB marketing integration specs create their own fixtures and clean up.
`campaign-deletion-preservation.integration.spec.ts` seeds an `OrderStatus` when the
fresh tenant DB has none, so a clean database run is deterministic.
