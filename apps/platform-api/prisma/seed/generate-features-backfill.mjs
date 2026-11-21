#!/usr/bin/env node
/**
 * Generate prisma/migrations/20261121170100_features_kind_backfill/
 * migration.sql from src/features/feature-content.ts — the single
 * source of truth for kind / category / scope / withoutAccess.
 *
 * Run from apps/platform-api:
 *   node ../../node_modules/tsx/dist/cli.mjs prisma/seed/generate-features-backfill.mjs
 * (tsx resolves the .ts content import; plain `node` cannot import
 * TypeScript. The repo root already has tsx — no new dependency.)
 *
 * Re-running overwrites the migration. The migration is unpushed and
 * has run only on disposable test DBs, so regeneration is safe; once
 * it ships, never regenerate — write a new migration instead.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_CONTENT } from '../../src/features/feature-content.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(
  HERE,
  '..',
  'migrations',
  '20261121170100_features_kind_backfill',
  'migration.sql',
);

const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;

const header = `-- Features page backfill (Boss point 1, 2026-11-21). DATA ONLY —
-- no DDL. Generated from src/features/feature-content.ts (the
-- single source of truth) by prisma/seed/generate-features-backfill.mjs;
-- do not hand-edit — regenerate.
--
-- kind: the add-on batch (Boss §0 decisions) becomes ADD_ON;
-- everything else keeps the INITIAL default from the DDL
-- migration. Guarded by kind = 'INITIAL' so a re-run never
-- overwrites an operator kind change.
-- scope/withoutAccess: set only where still NULL — never
-- overwrites operator-edited text.
-- category: code-owned (no console editor), set unconditionally
-- to the A–O catalogue grouping (replaces the old coarse
-- Admin/Storefront/Courier/... labels from the seed's
-- categoryFor).
`;

const entries = Object.entries(FEATURE_CONTENT);
const addOnKeys = entries
  .filter(([, content]) => content.kind === 'add-on')
  .map(([key]) => key);

const lines = [header];
lines.push(
  `UPDATE "Feature" SET "kind" = 'ADD_ON' WHERE "key" IN (${addOnKeys.map(sql).join(', ')}) AND "kind" = 'INITIAL';`,
  '',
);
for (const [key, content] of entries) {
  lines.push(
    `UPDATE "Feature" SET "category" = ${sql(content.category)} WHERE "key" = ${sql(key)};`,
    `UPDATE "Feature" SET "scope" = ${sql(content.scope)}, "withoutAccess" = ${sql(content.withoutAccess)} WHERE "key" = ${sql(key)} AND "scope" IS NULL;`,
  );
}

writeFileSync(OUT_PATH, `${lines.join('\n')}\n`);
console.log(
  `[generate-features-backfill] wrote ${entries.length} features (${addOnKeys.length} add-on) to ${OUT_PATH}`,
);
