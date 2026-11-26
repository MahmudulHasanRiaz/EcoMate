// Shared organization-limit logic (design §2) — ONE implementation, two
// call sites, so the limit can never drift between signup paths:
//   1. the org plugin's `organizationLimit` function form (src/auth-options.ts)
//   2. the adapter-level provisioning path (src/internal-routes.ts), which
//      bypasses `auth.api` entirely (see README "Org provisioning").
//
// Limit resolution order (§2.3):
//   1. Platform setting `organization_limit` fetched from platform-api
//      GET {AUTH_PLATFORM_API_URL}/internal/settings/organization-limit,
//      cached in memory for 60 s. On fetch failure / 404 / non-numeric
//      value: keep the last good value and log a warning.
//   2. Fallback: env AUTH_ORG_LIMIT (default 5, D12).
// The resolved value is clamped to [1, 1000] — a 0/negative setting must
// never block all org creation.
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from './generated/prisma/index.js';
import { logger } from './logger.js';

export const ORG_LIMIT_ERROR_CODE =
  'YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS';
export const ORG_LIMIT_CACHE_TTL_MS = 60_000;
export const ORG_LIMIT_MIN = 1;
export const ORG_LIMIT_MAX = 1000;

export function clampOrgLimit(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.min(ORG_LIMIT_MAX, Math.max(ORG_LIMIT_MIN, Math.trunc(value)));
}

export interface OrgLimitResolverOptions {
  platformApiUrl?: string;
  internalSecret?: string | null;
  fallback?: number;
  fetchFn?: typeof fetch;
}

let cachedLimit: number | null = null;
let cachedAt = 0;

/** Test-only: drop the 60 s settings cache. */
export function __resetOrgLimitCache(): void {
  cachedLimit = null;
  cachedAt = 0;
}

export async function resolveOrganizationLimit(
  opts: OrgLimitResolverOptions = {},
): Promise<number> {
  const fallback = clampOrgLimit(opts.fallback ?? 5);
  const now = Date.now();
  if (cachedLimit !== null && now - cachedAt < ORG_LIMIT_CACHE_TTL_MS) {
    return cachedLimit;
  }
  const platformApiUrl = opts.platformApiUrl || '';
  if (!platformApiUrl || !opts.internalSecret) {
    // No platform-api to ask (Phase 4 endpoint not built yet, or no
    // secret configured): the env fallback rules. Not an error — the
    // fetch 404s until the endpoint exists, by design.
    cachedLimit = fallback;
    cachedAt = now;
    return fallback;
  }
  try {
    const fetchFn = opts.fetchFn ?? fetch;
    const res = await fetchFn(
      `${platformApiUrl.replace(/\/$/, '')}/internal/settings/organization-limit`,
      {
        headers: { 'x-platform-service-token': opts.internalSecret },
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!res.ok) {
      logger.warn('auth.org_limit.fetch_failed', {
        status: res.status,
        fallback,
      });
      cachedLimit = cachedLimit ?? fallback;
      cachedAt = now;
      return cachedLimit;
    }
    const body: unknown = await res.json();
    const raw =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>)['limit']
        : undefined;
    const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(n)) {
      logger.warn('auth.org_limit.non_numeric', { fallback });
      cachedLimit = cachedLimit ?? fallback;
      cachedAt = now;
      return cachedLimit;
    }
    cachedLimit = clampOrgLimit(n);
    cachedAt = now;
    return cachedLimit;
  } catch (err) {
    logger.warn('auth.org_limit.fetch_error', {
      error: err instanceof Error ? err.message : String(err),
      fallback,
    });
    cachedLimit = cachedLimit ?? fallback;
    cachedAt = now;
    return cachedLimit;
  }
}

/** Count the organizations a user belongs to (member rows for the user). */
export async function countUserOrganizations(
  prisma: PrismaClient,
  userId: string,
): Promise<number> {
  return prisma.member.count({ where: { userId } });
}

export async function isOrganizationLimitReached(
  prisma: PrismaClient,
  userId: string,
  opts: OrgLimitResolverOptions = {},
): Promise<boolean> {
  const limit = await resolveOrganizationLimit(opts);
  const count = await countUserOrganizations(prisma, userId);
  return count >= limit;
}

/**
 * The plugin function form (design §2): return true when the limit is
 * reached — the docs wording is correct, not inverted (SOURCE:
 * dist/plugins/organization/routes/crud-org.mjs:61 — function form blocks
 * when the awaited return is truthy).
 */
export function makeOrganizationLimitChecker(
  prisma: PrismaClient | null | undefined,
  opts: OrgLimitResolverOptions = {},
): (user: { id: string }) => Promise<boolean> {
  return async (user) => {
    if (!prisma) {
      // No database handle (schema-generation context only — this function
      // never runs there). Fail closed rather than allow unbounded creates.
      logger.warn('auth.org_limit.no_prisma', { userId: user.id });
      return true;
    }
    return isOrganizationLimitReached(prisma, user.id, opts);
  };
}

export class OrgLimitError extends Error {
  readonly code = ORG_LIMIT_ERROR_CODE;
  constructor() {
    super(ORG_LIMIT_ERROR_CODE);
  }
}

export interface ProvisionOrganizationInput {
  userId: string;
  name: string;
  slug: string;
}

/**
 * Adapter-level provisioning create (the provisioning-gap decision,
 * design §2.2 + §6.2): create the org + owner-member rows directly via
 * Prisma — the same rows `createOrganization` writes — because with a
 * dynamic baseURL and no fallback, `auth.api.createOrganization` cannot
 * run as a system action (bare call → 500 baseURL error; headers but no
 * session → 401; with a session → 403 under
 * `allowUserToCreateOrganization: false`). The org limit is enforced here
 * with the SAME module as the plugin function form, since the adapter
 * path skips the plugin entirely.
 */
export async function provisionOrganization(
  prisma: PrismaClient,
  input: ProvisionOrganizationInput,
  opts: OrgLimitResolverOptions = {},
): Promise<{ id: string; name: string; slug: string }> {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) {
    const err = new Error('user not found') as Error & { code: string };
    err.code = 'USER_NOT_FOUND';
    throw err;
  }
  if (await isOrganizationLimitReached(prisma, input.userId, opts)) {
    throw new OrgLimitError();
  }
  const existing = await prisma.organization.findUnique({
    where: { slug: input.slug },
  });
  if (existing) {
    const err = new Error('organization already exists') as Error & {
      code: string;
    };
    err.code = 'ORGANIZATION_ALREADY_EXISTS';
    throw err;
  }
  const now = new Date();
  const created = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        id: `org_${randomUUID()}`,
        name: input.name,
        slug: input.slug,
        createdAt: now,
      },
    });
    await tx.member.create({
      data: {
        id: `mem_${randomUUID()}`,
        userId: input.userId,
        organizationId: org.id,
        role: 'owner',
        createdAt: now,
      },
    });
    return org;
  });
  return { id: created.id, name: created.name, slug: created.slug };
}
