// Service-owned internal routes (plain HTTP, NOT Better Auth endpoints):
//   POST /internal/users/role-sync
//   POST /internal/organizations/provision
//   POST /internal/users, GET /internal/users/:id,
//   GET /internal/users/by-email, GET /internal/users/search,
//   PATCH /internal/users/:id, DELETE /internal/users/:id
//   POST /internal/users/:id/mfa/reset (Phase 4 — unified console MFA reset)
//   POST /internal/users/:id/sessions/revoke-all (Phase 4)
//   GET /internal/users/:id/sessions (Phase 4)
//   DELETE /internal/users/:id/sessions/:sessionId (Phase 4)
// All require `x-platform-service-token` == INTERNAL_SERVICE_SECRET
// (503 when the secret is unconfigured). Caddy never routes /internal/*
// from any public host; only platform-api and the tenant backend call
// these on the internal URL.
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
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
  /** URL query params (GET routes). */
  query?: Record<string, string>;
  /** Path params (e.g. { userId } for /internal/users/:id). */
  params?: Record<string, string>;
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

// ---------------------------------------------------------------------------
// Phase 3 — internal user CRUD for the tenant backend (central-auth cutover)
// ---------------------------------------------------------------------------
//
// The tenant backend's users/employees/customer-linking services used to
// write tenant-DB `better_auth_users`/`better_auth_accounts` rows directly
// (baPrisma). After the cutover those rows live here, in `ecomate_auth`,
// and the backend must never touch this database directly — it calls these
// internal endpoints instead (same secret + audit conventions as
// role-sync/provision above).
//
// Why adapter-level Prisma, not `auth.api.signUpEmail`: signUpEmail mints a
// live session for the new user and sends the verification email — both
// wrong for an admin-created user (the operator never sees that session;
// no verification mail is wanted at create time). The provision endpoint
// already set the precedent: system actions use adapter-level writes.
// Passwords are hashed with BA's own scrypt `hashPassword`, providerId
// 'credential' (BA 1.7.28 — Phase 2 proved the 'email' → 'credential'
// rewrite). New user ids are `randomUUID()` (the migration scripts use the
// same for collision-regenerated ids); BA-native sign-ups keep their own
// cuid-style ids — nothing in the service depends on the id format.
// Tenant staff roles are the org-plugin custom roles (owner, admin,
// cashier, packing_assistant, employee — see auth-options.ts); customers
// are plain users and never get a member row (D4).

/** Tenant staff org roles — the org-plugin custom roles, nothing else. */
export const TENANT_ORG_ROLES = [
  'owner',
  'admin',
  'cashier',
  'packing_assistant',
  'employee',
] as const;

type InternalUserDeps = { prisma: PrismaClient; config: AuthServiceConfig };

function publicUserShape(u: {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: string | null;
  platformRole: string | null;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: u.emailVerified,
    role: u.role,
    platformRole: u.platformRole,
    createdAt: u.createdAt.toISOString(),
  };
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return email.includes('@') ? email : null;
}

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}

/**
 * POST /internal/users — create a central user (+ credential account when
 * a password is given, + org member row when organizationId/orgRole are
 * given). 201 { id, email, emailVerified, organizationId?, orgRole? };
 * 400 validation; 404 organization_not_found; 403
 * organization_member_limit (membershipLimit, default 100); 409
 * email_exists.
 */
export async function handleCreateInternalUser(
  deps: InternalUserDeps,
  req: InternalRouteRequest,
): Promise<InternalRouteResult> {
  const denied = checkInternalSecret(deps.config, req.headers);
  if (denied) return denied;
  const email = normalizeEmail(req.body?.['email']);
  const name = req.body?.['name'];
  const password = req.body?.['password'];
  const emailVerified = req.body?.['emailVerified'];
  const organizationId = req.body?.['organizationId'];
  const orgRole = req.body?.['orgRole'];
  if (
    !email ||
    typeof name !== 'string' ||
    name.trim().length === 0 ||
    (password !== undefined &&
      (typeof password !== 'string' || password.length < 8)) ||
    (emailVerified !== undefined && typeof emailVerified !== 'boolean') ||
    (organizationId !== undefined && typeof organizationId !== 'string') ||
    (orgRole !== undefined &&
      (typeof orgRole !== 'string' ||
        !(TENANT_ORG_ROLES as readonly string[]).includes(orgRole))) ||
    (orgRole !== undefined && organizationId === undefined)
  ) {
    return { status: 400, json: { error: 'invalid_user_body' } };
  }
  if (organizationId !== undefined) {
    const org = await deps.prisma.organization.findUnique({
      where: { id: organizationId as string },
      select: { id: true },
    });
    if (!org) {
      return { status: 404, json: { error: 'organization_not_found' } };
    }
    const memberCount = await deps.prisma.member.count({
      where: { organizationId: organizationId as string },
    });
    if (memberCount >= deps.config.membershipLimit) {
      return { status: 403, json: { error: 'organization_member_limit' } };
    }
  }
  try {
    const created = await deps.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: randomUUID(),
          name: (name as string).trim(),
          email,
          // D7 flip: default TRUE, not false. Users created here are
          // created by the tenant backend / an admin — a trusted,
          // out-of-band-verified account — and an `emailVerified: false`
          // row loses its password account on first OTP login (BA
          // 1.7.28 revokeUnprovenAccountAccess). An explicit caller
          // value of `false` is still honoured (the caller then owns
          // the consequence), but the default must never create an
          // unverified password user. Same rule as script 01.
          emailVerified: (emailVerified as boolean | undefined) ?? true,
          role: 'user',
        },
      });
      if (password !== undefined) {
        await tx.account.create({
          data: {
            id: `acc_${randomUUID()}`,
            accountId: user.id,
            providerId: 'credential',
            userId: user.id,
            password: await hashPassword(password as string),
          },
        });
      }
      if (organizationId !== undefined) {
        await tx.member.create({
          data: {
            id: `mem_${randomUUID()}`,
            organizationId: organizationId as string,
            userId: user.id,
            role: orgRole as string,
            createdAt: new Date(),
          },
        });
      }
      return user;
    });
    logger.audit('auth.user.created', {
      requestId: req.requestId,
      userId: created.id,
      email: created.email,
      organizationId:
        typeof organizationId === 'string' ? organizationId : undefined,
    });
    return {
      status: 201,
      json: {
        id: created.id,
        email: created.email,
        emailVerified: created.emailVerified,
        ...(organizationId !== undefined
          ? {
              organizationId: organizationId as string,
              orgRole: orgRole as string,
            }
          : {}),
      },
    };
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      return { status: 409, json: { error: 'email_exists' } };
    }
    logger.error('auth.user.create_failed', {
      requestId: req.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 500, json: { error: 'user_create_failed' } };
  }
}

/**
 * GET /internal/users/:id — fetch one central user. 200 public shape;
 * 404 user_not_found.
 */
export async function handleGetInternalUserById(
  deps: InternalUserDeps,
  req: InternalRouteRequest,
): Promise<InternalRouteResult> {
  const denied = checkInternalSecret(deps.config, req.headers);
  if (denied) return denied;
  const userId = req.params?.['userId'];
  if (!userId) {
    return { status: 400, json: { error: 'userId_required' } };
  }
  const user = await deps.prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { status: 404, json: { error: 'user_not_found' } };
  }
  return { status: 200, json: publicUserShape(user) };
}

/**
 * GET /internal/users/by-email?email= — fetch one central user by email
 * (lowercased, like the stored value). 200 public shape; 400
 * email_required; 404 user_not_found.
 */
export async function handleGetInternalUserByEmail(
  deps: InternalUserDeps,
  req: InternalRouteRequest,
): Promise<InternalRouteResult> {
  const denied = checkInternalSecret(deps.config, req.headers);
  if (denied) return denied;
  const email = normalizeEmail(req.query?.['email']);
  if (!email) {
    return { status: 400, json: { error: 'email_required' } };
  }
  const user = await deps.prisma.user.findUnique({ where: { email } });
  if (!user) {
    return { status: 404, json: { error: 'user_not_found' } };
  }
  return { status: 200, json: publicUserShape(user) };
}

/**
 * GET /internal/users/search?q=&limit= — search central users by name or
 * email substring (case-insensitive), for the employee picker (the old
 * `searchBaUsers` listed tenant-DB BA users with no Employee row; the
 * backend filters out ids that already have an Employee row). 200
 * { users: [{ id, name, email }] }; 400 q_required; limit defaults to 20,
 * clamped to [1, 20].
 */
export async function handleSearchInternalUsers(
  deps: InternalUserDeps,
  req: InternalRouteRequest,
): Promise<InternalRouteResult> {
  const denied = checkInternalSecret(deps.config, req.headers);
  if (denied) return denied;
  const q = (req.query?.['q'] ?? '').trim();
  if (!q) {
    return { status: 400, json: { error: 'q_required' } };
  }
  const rawLimit = Number(req.query?.['limit'] ?? 20);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(20, Math.max(1, Math.floor(rawLimit)))
    : 20;
  const users = await deps.prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, email: true },
    orderBy: { email: 'asc' },
    take: limit,
  });
  return { status: 200, json: { users } };
}

/**
 * PATCH /internal/users/:id — update a central user. Body subset: name,
 * email, password (re-hashed with scrypt; upserts the credential account),
 * emailVerified, plus organizationId + orgRole for the member row
 * (orgRole null removes the membership — used when an employee is
 * un-hired back to `customer`, since customers are never members, D4).
 * 200 public shape (+ organizationId/orgRole when membership was touched);
 * 400 validation; 404 user_not_found / organization_not_found; 409
 * email_exists.
 */
export async function handleUpdateInternalUser(
  deps: InternalUserDeps,
  req: InternalRouteRequest,
): Promise<InternalRouteResult> {
  const denied = checkInternalSecret(deps.config, req.headers);
  if (denied) return denied;
  const userId = req.params?.['userId'];
  if (!userId) {
    return { status: 400, json: { error: 'userId_required' } };
  }
  const body = req.body ?? {};
  const name = body['name'];
  const emailRaw = body['email'];
  const password = body['password'];
  const emailVerified = body['emailVerified'];
  const organizationId = body['organizationId'];
  const orgRole = body['orgRole'];
  const email =
    emailRaw === undefined ? undefined : normalizeEmail(emailRaw);
  if (
    (name !== undefined &&
      (typeof name !== 'string' || name.trim().length === 0)) ||
    (emailRaw !== undefined && email === null) ||
    (password !== undefined &&
      (typeof password !== 'string' || password.length < 8)) ||
    (emailVerified !== undefined && typeof emailVerified !== 'boolean') ||
    (organizationId !== undefined && typeof organizationId !== 'string') ||
    (orgRole !== undefined &&
      orgRole !== null &&
      (typeof orgRole !== 'string' ||
        !(TENANT_ORG_ROLES as readonly string[]).includes(orgRole))) ||
    (orgRole !== undefined && organizationId === undefined)
  ) {
    return { status: 400, json: { error: 'invalid_user_body' } };
  }
  const existing = await deps.prisma.user.findUnique({
    where: { id: userId },
  });
  if (!existing) {
    return { status: 404, json: { error: 'user_not_found' } };
  }
  if (email && email !== existing.email) {
    const clash = await deps.prisma.user.findUnique({ where: { email } });
    if (clash) {
      return { status: 409, json: { error: 'email_exists' } };
    }
  }
  if (organizationId !== undefined) {
    const org = await deps.prisma.organization.findUnique({
      where: { id: organizationId as string },
      select: { id: true },
    });
    if (!org) {
      return { status: 404, json: { error: 'organization_not_found' } };
    }
  }
  try {
    const updated = await deps.prisma.$transaction(async (tx) => {
      const userData: Record<string, unknown> = {};
      if (name !== undefined) userData['name'] = (name as string).trim();
      if (email !== undefined) userData['email'] = email;
      if (emailVerified !== undefined) {
        userData['emailVerified'] = emailVerified as boolean;
      }
      const user =
        Object.keys(userData).length > 0
          ? await tx.user.update({ where: { id: userId }, data: userData })
          : existing;
      if (password !== undefined) {
        const hashed = await hashPassword(password as string);
        const account = await tx.account.findFirst({
          where: { userId, providerId: 'credential' },
        });
        if (account) {
          await tx.account.update({
            where: { id: account.id },
            data: { password: hashed },
          });
        } else {
          await tx.account.create({
            data: {
              id: `acc_${randomUUID()}`,
              accountId: userId,
              providerId: 'credential',
              userId,
              password: hashed,
            },
          });
        }
      }
      if (organizationId !== undefined) {
        const orgId = organizationId as string;
        if (orgRole === null) {
          await tx.member.deleteMany({
            where: { organizationId: orgId, userId },
          });
        } else {
          const member = await tx.member.findFirst({
            where: { organizationId: orgId, userId },
          });
          if (member) {
            await tx.member.update({
              where: { id: member.id },
              data: { role: orgRole as string },
            });
          } else {
            const memberCount = await tx.member.count({
              where: { organizationId: orgId },
            });
            if (memberCount >= deps.config.membershipLimit) {
              throw Object.assign(
                new Error('organization_member_limit'),
                { code: 'ORG_MEMBER_LIMIT' },
              );
            }
            await tx.member.create({
              data: {
                id: `mem_${randomUUID()}`,
                organizationId: orgId,
                userId,
                role: orgRole as string,
                createdAt: new Date(),
              },
            });
          }
        }
      }
      return user;
    });
    logger.audit('auth.user.updated', {
      requestId: req.requestId,
      userId,
      organizationId:
        typeof organizationId === 'string' ? organizationId : undefined,
    });
    return {
      status: 200,
      json: {
        ...publicUserShape(updated),
        ...(organizationId !== undefined
          ? {
              organizationId: organizationId as string,
              orgRole: (orgRole as string | null) ?? null,
            }
          : {}),
      },
    };
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: unknown }).code === 'ORG_MEMBER_LIMIT'
    ) {
      return { status: 403, json: { error: 'organization_member_limit' } };
    }
    if (isPrismaUniqueViolation(err)) {
      return { status: 409, json: { error: 'email_exists' } };
    }
    logger.error('auth.user.update_failed', {
      requestId: req.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 500, json: { error: 'user_update_failed' } };
  }
}

/**
 * DELETE /internal/users/:id — delete a central user. Sessions, accounts,
 * member rows, invitations and two-factor rows cascade at the DB level
 * (onDelete: Cascade on every User relation). 200 { id, deleted: true };
 * 404 user_not_found.
 */
export async function handleDeleteInternalUser(
  deps: InternalUserDeps,
  req: InternalRouteRequest,
): Promise<InternalRouteResult> {
  const denied = checkInternalSecret(deps.config, req.headers);
  if (denied) return denied;
  const userId = req.params?.['userId'];
  if (!userId) {
    return { status: 400, json: { error: 'userId_required' } };
  }
  const existing = await deps.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!existing) {
    return { status: 404, json: { error: 'user_not_found' } };
  }
  await deps.prisma.user.delete({ where: { id: userId } });
  logger.audit('auth.user.deleted', {
    requestId: req.requestId,
    userId,
  });
  return { status: 200, json: { id: userId, deleted: true } };
}

// ---------------------------------------------------------------------------
// Phase 4 (console cutover) — MFA reset + session management for console
// operators. platform-api calls these with the internal secret; the
// console never touches them directly. The two mandated routes
// (mfa/reset, sessions/revoke-all) are joined by list + revoke-one,
// because BA's `list-sessions` is self-only and the operator BA role
// cannot list/revoke ANOTHER operator's sessions — without service-owned
// routes the console's Users → Sessions page could not work in
// central-ba mode (see platform-api BUILD-SUMMARY).
// ---------------------------------------------------------------------------

/**
 * POST /internal/users/:id/mfa/reset — unified console MFA reset.
 * Deletes the user's TwoFactor rows (secret + backup codes) and clears
 * `user.twoFactorEnabled`. The operator re-enrols on next login. 200
 * { userId, reset: true, twoFactorEnabled: false }; 404 user_not_found.
 * Audited; the platform-api caller revokes the operator's sessions
 * itself (revoke-all below) so the reset also kills live sessions.
 */
export async function handleResetUserMfa(
  deps: InternalUserDeps,
  req: InternalRouteRequest,
): Promise<InternalRouteResult> {
  const denied = checkInternalSecret(deps.config, req.headers);
  if (denied) return denied;
  const userId = req.params?.['userId'];
  if (!userId) {
    return { status: 400, json: { error: 'userId_required' } };
  }
  const existing = await deps.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!existing) {
    return { status: 404, json: { error: 'user_not_found' } };
  }
  await deps.prisma.twoFactor.deleteMany({ where: { userId } });
  await deps.prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: false },
  });
  logger.audit('auth.user.mfa_reset', {
    requestId: req.requestId,
    userId,
  });
  return {
    status: 200,
    json: { userId, reset: true, twoFactorEnabled: false },
  };
}

/**
 * POST /internal/users/:id/sessions/revoke-all — revoke every BA session
 * for the user (disable / password reset / MFA reset). 200
 * { userId, revokedCount }; 404 user_not_found.
 */
export async function handleRevokeAllUserSessions(
  deps: InternalUserDeps,
  req: InternalRouteRequest,
): Promise<InternalRouteResult> {
  const denied = checkInternalSecret(deps.config, req.headers);
  if (denied) return denied;
  const userId = req.params?.['userId'];
  if (!userId) {
    return { status: 400, json: { error: 'userId_required' } };
  }
  const existing = await deps.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!existing) {
    return { status: 404, json: { error: 'user_not_found' } };
  }
  const { count } = await deps.prisma.session.deleteMany({
    where: { userId },
  });
  logger.audit('auth.user.sessions_revoked', {
    requestId: req.requestId,
    userId,
    revokedCount: count,
  });
  return { status: 200, json: { userId, revokedCount: count } };
}

/**
 * GET /internal/users/:id/sessions — list a user's BA sessions for the
 * console Users → Sessions page. Tokens are NEVER returned (the
 * `token` column is not selected). 200
 * { data: [{ id, userAgent, ipAddress, createdAt, lastUsedAt,
 *            expiresAt, revoked }] }.
 *
 * `revoked` has no BA column behind it: a BA session row is either
 * present (live) or deleted (revoked). The only in-row signal is
 * expiry, so `revoked` means `expiresAt < now` — an expired row the
 * service has not pruned yet. Live rows report `revoked: false`.
 */
export async function handleListUserSessions(
  deps: InternalUserDeps,
  req: InternalRouteRequest,
): Promise<InternalRouteResult> {
  const denied = checkInternalSecret(deps.config, req.headers);
  if (denied) return denied;
  const userId = req.params?.['userId'];
  if (!userId) {
    return { status: 400, json: { error: 'userId_required' } };
  }
  const existing = await deps.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!existing) {
    return { status: 404, json: { error: 'user_not_found' } };
  }
  const now = new Date();
  const rows = await deps.prisma.session.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      userAgent: true,
      ipAddress: true,
      createdAt: true,
      updatedAt: true,
      expiresAt: true,
    },
  });
  return {
    status: 200,
    json: {
      data: rows.map((row) => ({
        id: row.id,
        userAgent: row.userAgent ?? null,
        ipAddress: row.ipAddress ?? null,
        createdAt: row.createdAt.toISOString(),
        // BA has no last-used column; updatedAt moves on session
        // refresh and is the closest signal.
        lastUsedAt: row.updatedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        revoked: row.expiresAt < now,
      })),
    },
  };
}

/**
 * DELETE /internal/users/:id/sessions/:sessionId — revoke one BA session.
 * 200 { userId, sessionId, revoked: true }; 404 user_not_found or
 * session_not_found (the session must belong to the user).
 */
export async function handleRevokeUserSession(
  deps: InternalUserDeps,
  req: InternalRouteRequest,
): Promise<InternalRouteResult> {
  const denied = checkInternalSecret(deps.config, req.headers);
  if (denied) return denied;
  const userId = req.params?.['userId'];
  const sessionId = req.params?.['sessionId'];
  if (!userId) {
    return { status: 400, json: { error: 'userId_required' } };
  }
  if (!sessionId) {
    return { status: 400, json: { error: 'sessionId_required' } };
  }
  const existing = await deps.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!existing) {
    return { status: 404, json: { error: 'user_not_found' } };
  }
  const session = await deps.prisma.session.findFirst({
    where: { id: sessionId, userId },
    select: { id: true },
  });
  if (!session) {
    return { status: 404, json: { error: 'session_not_found' } };
  }
  await deps.prisma.session.delete({ where: { id: sessionId } });
  logger.audit('auth.user.session_revoked', {
    requestId: req.requestId,
    userId,
    sessionId,
  });
  return {
    status: 200,
    json: { userId, sessionId, revoked: true },
  };
}
