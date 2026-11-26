// Service-owned internal routes (plain HTTP, NOT Better Auth endpoints):
//   POST /internal/users/role-sync
//   POST /internal/organizations/provision
// Both require `x-platform-service-token` == INTERNAL_SERVICE_SECRET
// (503 when the secret is unconfigured). Caddy never routes /internal/*
// from any public host; only platform-api calls these on the internal URL.
import { timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from './generated/prisma/index.js';
import type { AuthServiceConfig } from './config.js';
import { logger } from './logger.js';
import {
  ORG_LIMIT_ERROR_CODE,
  provisionOrganization,
} from './org-limits.js';

/** Console platform roles (D5=A) — the only values role-sync accepts. */
export const CONSOLE_PLATFORM_ROLES = [
  'SUPERADMIN',
  'BILLING',
  'SUPPORT',
  'READONLY',
] as const;

/**
 * Map a console platformRole to the BA admin-plugin role (design §1):
 * only SUPERADMIN/SUPPORT hold `operator`; everyone else is `user`.
 * This is one of only two places that ever derive user.role from
 * platformRole (the other is the Phase 2 migration). Break-glass is a
 * direct DB update per runbook — never adminUserIds.
 */
export function platformRoleToBaRole(
  platformRole: string,
): 'operator' | 'user' {
  return platformRole === 'SUPERADMIN' || platformRole === 'SUPPORT'
    ? 'operator'
    : 'user';
}

export interface InternalRouteRequest {
  body: Record<string, unknown> | null;
  headers: Headers;
  requestId: string;
}

export interface InternalRouteResult {
  status: number;
  json: Record<string, unknown>;
}

function checkInternalSecret(
  config: AuthServiceConfig,
  headers: Headers,
): InternalRouteResult | null {
  if (!config.internalServiceSecret) {
    return { status: 503, json: { error: 'internal_service_unavailable' } };
  }
  const presented = headers.get('x-platform-service-token');
  const a = presented ? Buffer.from(presented) : Buffer.alloc(0);
  const b = Buffer.from(config.internalServiceSecret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { status: 401, json: { error: 'unauthorized' } };
  }
  return null;
}

/**
 * Role sync (design §1 + §6.10 Phase 4): platform-api calls this whenever
 * a console operator's platformRole changes, so BA `user.role` stays in
 * sync with the console matrix. Sets BOTH platformRole and the derived
 * BA role (direct Prisma write — the databaseHooks stripping only applies
 * to BA client writes, not to this service-owned route).
 */
export async function handleRoleSync(
  deps: { prisma: PrismaClient; config: AuthServiceConfig },
  req: InternalRouteRequest,
): Promise<InternalRouteResult> {
  const denied = checkInternalSecret(deps.config, req.headers);
  if (denied) return denied;
  const userId = req.body?.['userId'];
  const platformRole = req.body?.['platformRole'];
  if (typeof userId !== 'string' || userId.length === 0) {
    return { status: 400, json: { error: 'userId_required' } };
  }
  if (
    typeof platformRole !== 'string' ||
    !(CONSOLE_PLATFORM_ROLES as readonly string[]).includes(platformRole)
  ) {
    return { status: 400, json: { error: 'invalid_platformRole' } };
  }
  const existing = await deps.prisma.user.findUnique({ where: { id: userId } });
  if (!existing) {
    return { status: 404, json: { error: 'user_not_found' } };
  }
  const role = platformRoleToBaRole(platformRole);
  await deps.prisma.user.update({
    where: { id: userId },
    data: { platformRole, role },
  });
  logger.audit('auth.role_synced', {
    requestId: req.requestId,
    userId,
    platformRole,
    role,
  });
  return { status: 200, json: { userId, platformRole, role } };
}

/**
 * Provisioning create (design §2.3): adapter-level org creation for
 * system actions (signup provisioning from platform-api). Enforces the
 * org limit via the shared org-limits module — the plugin function form
 * never runs on this path, so the check lives here.
 */
export async function handleProvisionOrganization(
  deps: { prisma: PrismaClient; config: AuthServiceConfig },
  req: InternalRouteRequest,
): Promise<InternalRouteResult> {
  const denied = checkInternalSecret(deps.config, req.headers);
  if (denied) return denied;
  const userId = req.body?.['userId'];
  const name = req.body?.['name'];
  const slug = req.body?.['slug'];
  if (
    typeof userId !== 'string' ||
    typeof name !== 'string' ||
    typeof slug !== 'string' ||
    !userId ||
    !name ||
    !slug
  ) {
    return {
      status: 400,
      json: { error: 'userId_name_slug_required' },
    };
  }
  try {
    const org = await provisionOrganization(
      deps.prisma,
      { userId, name, slug },
      {
        platformApiUrl: deps.config.platformApiUrl,
        internalSecret: deps.config.internalServiceSecret,
        fallback: deps.config.organizationLimit,
      },
    );
    logger.audit('auth.organization.provisioned', {
      requestId: req.requestId,
      organizationId: org.id,
      userId,
    });
    return { status: 201, json: org };
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';
    if (code === ORG_LIMIT_ERROR_CODE) {
      return { status: 403, json: { error: ORG_LIMIT_ERROR_CODE } };
    }
    if (code === 'ORGANIZATION_ALREADY_EXISTS') {
      return { status: 409, json: { error: code } };
    }
    if (code === 'USER_NOT_FOUND') {
      return { status: 404, json: { error: 'user_not_found' } };
    }
    logger.error('auth.organization.provision_failed', {
      requestId: req.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 500, json: { error: 'provision_failed' } };
  }
}
