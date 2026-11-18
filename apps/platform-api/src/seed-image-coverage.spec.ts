/**
 * Regression test for the run #13 staging redeploy failure.
 *
 * prisma/seed.ts runs inside the platform-api container via tsx, and the
 * runner image ships only a few src/ paths (see the Dockerfile COPY lines).
 * The landing implementation added a `../src/landing-content/...` import to
 * seed.ts without a matching COPY, so the seed crashed with MODULE_NOT_FOUND
 * and the container never became healthy — while every unit test passed,
 * because tests run against the full working copy where src/ exists.
 *
 * This spec fails the build if seed.ts ever imports a src/ module that the
 * Dockerfile does not ship into the runner image.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const SEED_PATH = join(ROOT, 'prisma', 'seed.ts');
const DOCKERFILE_PATH = join(ROOT, 'Dockerfile');

function seedSrcImports(): string[] {
  const seed = readFileSync(SEED_PATH, 'utf8');
  const imports = new Set<string>();
  for (const match of seed.matchAll(/from\s+['"]\.\.\/src\/([^'"]+)['"]/g)) {
    imports.add(match[1]);
  }
  return [...imports].sort();
}

function dockerfileShippedSrcPaths(): string[] {
  const dockerfile = readFileSync(DOCKERFILE_PATH, 'utf8');
  const shipped: string[] = [];
  // COPY --from=builder /app/apps/platform-api/src/<path> ./src/<path>
  for (const match of dockerfile.matchAll(
    /^COPY --from=builder \/app\/apps\/platform-api\/src\/(\S+)\s+(\S+)/gm,
  )) {
    shipped.push(match[1]);
  }
  return shipped;
}

function isCovered(importPath: string, shipped: string[]): boolean {
  // An import `foo/bar` resolves to foo/bar.ts, foo/bar.tsx or
  // foo/bar/index.ts; a COPY covers it if it ships that exact file or a
  // parent directory of it.
  const candidates = [
    `${importPath}.ts`,
    `${importPath}.tsx`,
    `${importPath}/index.ts`,
  ];
  return candidates.some((candidate) =>
    shipped.some(
      (ship) => ship === candidate || candidate.startsWith(`${ship}/`),
    ),
  );
}

describe('seed image coverage (prisma/seed.ts vs Dockerfile)', () => {
  it('finds the known seed src/ imports (guard against a silent regex miss)', () => {
    const imports = seedSrcImports();
    expect(imports).toContain('generated/prisma');
    expect(imports).toContain('landing-content/landing-content-seed');
  });

  it('ships every src/ module seed.ts imports into the runner image', () => {
    const imports = seedSrcImports();
    const shipped = dockerfileShippedSrcPaths();
    expect(shipped.length).toBeGreaterThan(0);
    const uncovered = imports.filter((i) => !isCovered(i, shipped));
    expect(uncovered).toEqual([]);
  });
});
