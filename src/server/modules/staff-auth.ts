import { auth, clerkClient } from '@clerk/nextjs/server';
import prisma from '@/lib/prisma';
import { getPresetPermissions } from '@/lib/staff-permissions';
import { attachPageAccess } from '@/lib/page-access';
import { generateStaffCode } from '@server/utils/staffCode';
import { normalizeSalaryDetails, normalizeCommissionDetails } from '@server/utils/staff-compensation';
import { getRedisClient } from '@/server/queues/redis';

const dbRoleToUiRole: Record<string, string> = {
  SuperAdmin: 'SuperAdmin',
  Admin: 'Admin',
  Manager: 'Manager',
  PackingAssistant: 'Packing Assistant',
  Moderator: 'Moderator',
  Seller: 'Seller',
  CallAssistant: 'Call Assistant',
  CallCentreManager: 'Call Centre Manager',
  CourierManager: 'Courier Manager',
  CourierCallAssistant: 'Courier Call Assistant',
  VendorSupplier: 'Vendor/Supplier',
  CuttingMan: 'Cutting Master',
  Marketer: 'Marketer',
  FinanceManager: 'Finance Manager',
  ModaratorManager: 'Modarator Manager',
  ProjectManager: 'Project Manager',
  SalesRepresentative: 'Sales Representative',
  Custom: 'Custom',
};

const uiRoleToDbRole: Record<string, string> = {
  SuperAdmin: 'SuperAdmin',
  Admin: 'Admin',
  Manager: 'Manager',
  'Packing Assistant': 'PackingAssistant',
  Moderator: 'Moderator',
  Seller: 'Seller',
  'Call Assistant': 'CallAssistant',
  'Call Centre Manager': 'CallCentreManager',
  'Courier Manager': 'CourierManager',
  'Courier Call Assistant': 'CourierCallAssistant',
  'Vendor/Supplier': 'VendorSupplier',
  'Cutting Master': 'CuttingMan',
  Marketer: 'Marketer',
  'Finance Manager': 'FinanceManager',
  'Modarator Manager': 'ModaratorManager',
  'Project Manager': 'ProjectManager',
  'Sales Representative': 'SalesRepresentative',
  Custom: 'Custom',
};

const roleAliases: Record<string, string> = {
  modarator: 'Moderator',
  modaratorr: 'Moderator',
  callassistant: 'Call Assistant',
  'call assistant': 'Call Assistant',
  'call asistant': 'Call Assistant',
  callcentermanager: 'Call Centre Manager',
  couriercallassistant: 'Courier Call Assistant',
  courierrcallassistant: 'Courier Call Assistant',
  modaratormanager: 'Modarator Manager',
  'modarator manager': 'Modarator Manager',
  projectmanager: 'Project Manager',
  'project manager': 'Project Manager',
  salesrepresentative: 'Sales Representative',
  'sales representative': 'Sales Representative',
  sr: 'Sales Representative',
};

const normalizeRole = (role?: string | null) => {
  if (!role) return undefined;
  const trimmed = role.trim();
  const alias = roleAliases[trimmed.toLowerCase()];
  if (alias) return alias;
  // Direct mapping
  if (dbRoleToUiRole[trimmed]) return dbRoleToUiRole[trimmed];
  // Case-insensitive DB key match
  const key = Object.keys(dbRoleToUiRole).find(
    (k) => k.toLowerCase() === trimmed.toLowerCase()
  );
  if (key) return dbRoleToUiRole[key];
  // Case-insensitive UI value match
  const uiKey = Object.values(dbRoleToUiRole).find(
    (v) => v.toLowerCase() === trimmed.toLowerCase()
  );
  if (uiKey) return uiKey;
  // Return as-is if no match
  return trimmed;
};

const normalizeRoleToDb = (role?: string | null) => {
  const uiRole = normalizeRole(role);
  if (!uiRole) return undefined;
  return uiRoleToDbRole[uiRole] || 'Custom';
};

const normalizeEmail = (email?: string | null) => (email ? email.trim().toLowerCase() : undefined);

const STAFF_AUTH_TTL_MS = 5 * 60 * 1000;
const STAFF_AUTH_TTL_SEC = Math.floor(STAFF_AUTH_TTL_MS / 1000);
const staffAuthCache = new Map<string, { expires: number; value: StaffAuthResult }>();

async function getCachedStaffAuth(userId: string): Promise<StaffAuthResult | null> {
  const key = `staff-auth:${userId}`;
  const now = Date.now();
  const mem = staffAuthCache.get(key);
  if (mem && mem.expires > now) return mem.value;
  const redis = getRedisClient();
  if (redis) {
    const raw = await redis.get(key).catch(() => null);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as StaffAuthResult;
        staffAuthCache.set(key, { expires: now + STAFF_AUTH_TTL_MS, value: parsed });
        return parsed;
      } catch (err) {
        console.warn('[AUTH_CACHE_PARSE_ERROR]', err);
      }
    }
  }
  return null;
}

async function setCachedStaffAuth(userId: string, value: StaffAuthResult) {
  if (value.status !== 'ok') return; // avoid caching blocked
  const key = `staff-auth:${userId}`;
  const now = Date.now();
  staffAuthCache.set(key, { expires: now + STAFF_AUTH_TTL_MS, value });
  const redis = getRedisClient();
  if (redis) {
    await redis.set(key, JSON.stringify(value), 'EX', STAFF_AUTH_TTL_SEC).catch(() => null);
  }
}

// Helper function to get invite
async function getInviteForEmail(email?: string | null) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  try {
    const invite = await (prisma as any).staffInvite.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
    });
    if (invite) return invite;
  } catch (err) {
    console.warn('[WHOAMI_INVITE_DB]', err);
  }
  try {
    const client = await clerkClient();
    const clerkInvites = await client.invitations.getInvitationList({ emailAddress: [normalizedEmail] } as any);
    return clerkInvites?.data?.[0] || null;
  } catch (err) {
    console.warn('[WHOAMI_INVITE_CLERK]', err);
    return null;
  }
}

export type StaffAuthResult =
  | { status: 'ok'; staff: any }
  | { status: 'blocked' };

export async function getStaffAuthDetails(): Promise<StaffAuthResult> {
  const { userId } = await auth();
  if (!userId) return { status: 'blocked' };

  const cached = await getCachedStaffAuth(userId);
  if (cached) return cached;

  const safeFallback = (user: any) => {
    const publicMetadata: any = user?.publicMetadata || {};
    const role = normalizeRole(publicMetadata.role as string | undefined) || 'Custom';
    const basePermissions = role === 'Custom' ? (publicMetadata.permissions as any) || {} : getPresetPermissions(role);
    const permissions = attachPageAccess(basePermissions, role);
    const accessibleBusinessIds: string[] = (publicMetadata.accessibleBusinessIds as any) || [];
    const staffId = publicMetadata.staffId || `temp-${user?.id || 'unknown'}`;
    const result: StaffAuthResult = {
      status: 'ok' as const,
      staff: {
        id: staffId,
        clerkId: user?.id,
        staffCode: (publicMetadata.staffCode as string | undefined) || 'TEMP',
        name: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'User',
        email: user?.emailAddresses?.[0]?.emailAddress || 'unknown@example.com',
        phone: (publicMetadata.phone as string | undefined) || '',
        role,
        paymentType: publicMetadata.paymentType || 'Both',
        salaryDetails: publicMetadata.salaryDetails || { amount: 0, frequency: 'Monthly' },
        commissionDetails: publicMetadata.commissionDetails || { targetCount: 0, targetPeriod: null, targetEnabled: false },
        permissions,
        accessibleBusinessIds,
        accessibleBusinesses: [],
      },
    };
    return result;
  };

  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const primaryEmail = normalizeEmail(user.emailAddresses?.[0]?.emailAddress);
    const publicMetadata: any = user.publicMetadata || {};
    const clerkPhone = (publicMetadata.phone as string | undefined)
      || user.phoneNumbers?.[0]?.phoneNumber
      || (user as any)?.phone_numbers?.[0]?.phone_number;

    const dbStaff = await prisma.staffMember.findFirst({
      where: { clerkId: userId },
      include: { accessibleBusinesses: { select: { id: true } } },
    });

    let role: string | undefined = normalizeRole(publicMetadata.role as string | undefined)
      || normalizeRole((dbStaff as any)?.role);
    const invite = role ? null : await getInviteForEmail(primaryEmail);
    if (!role && invite?.role) role = normalizeRole(invite.role);

    if (!role) {
      return { status: 'blocked' };
    }
    const roleDb = normalizeRoleToDb(role) || 'Custom';

    const computedName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || primaryEmail || 'User';
    const computedEmail = primaryEmail || `${userId}@example.com`;
    const resolvedPhone = clerkPhone || (dbStaff as any)?.phone || `temp-${userId}`;
    const paymentType = dbStaff?.paymentType || publicMetadata.paymentType || 'Both';
    const hasDbStaff = Boolean(dbStaff);
    const rawSalaryDetails = hasDbStaff ? dbStaff?.salaryDetails : publicMetadata.salaryDetails;
    const rawCommissionDetails = hasDbStaff ? dbStaff?.commissionDetails : publicMetadata.commissionDetails;
    const salaryDetails = normalizeSalaryDetails(paymentType, rawSalaryDetails);
    const commissionDetails = normalizeCommissionDetails(paymentType, rawCommissionDetails);
    const basePermissions = role === 'Custom'
      ? (dbStaff?.permissions as any) || (publicMetadata.permissions as any) || (invite?.permissions as any) || {}
      : getPresetPermissions(role);
    const permissions = attachPageAccess(basePermissions, role);

    const inviteBusinessIds = Array.isArray(invite?.businessIds) ? (invite.businessIds as string[]) : [];
    const dbAccessibleBusinessIds = (dbStaff?.accessibleBusinesses || []).map((b) => b.id);
    let usingInviteBusinessIds = false;

    let allBusinessIdsCache: string[] | null = null;
    const loadAllBusinessIds = async () => {
      if (allBusinessIdsCache) return allBusinessIdsCache;
      allBusinessIdsCache = (await prisma.business.findMany({ select: { id: true } })).map((b) => b.id);
      return allBusinessIdsCache;
    };

    let accessibleBusinessIds: string[];
    if (role === 'Admin' || role === 'SuperAdmin') {
      if (inviteBusinessIds.length) {
        usingInviteBusinessIds = true;
        accessibleBusinessIds = inviteBusinessIds;
      } else {
        accessibleBusinessIds = await loadAllBusinessIds();
      }
    } else if (dbAccessibleBusinessIds.length) {
      accessibleBusinessIds = dbAccessibleBusinessIds;
    } else {
      if (inviteBusinessIds.length) usingInviteBusinessIds = true;
      accessibleBusinessIds = inviteBusinessIds;
    }

    // Validate invite-provided business IDs against the real DB to avoid connect failures.
    if (usingInviteBusinessIds && accessibleBusinessIds.length) {
      const validSet = new Set(await loadAllBusinessIds());
      accessibleBusinessIds = accessibleBusinessIds.filter((id) => validSet.has(id));

      // For Admins, fall back to all businesses if invite IDs are invalid/stale.
      if ((role === 'Admin' || role === 'SuperAdmin') && accessibleBusinessIds.length === 0) {
        accessibleBusinessIds = await loadAllBusinessIds();
      }
    }

    // For Admins without any access after validation, ensure full access.
    if ((role === 'Admin' || role === 'SuperAdmin') && accessibleBusinessIds.length === 0) {
      accessibleBusinessIds = await loadAllBusinessIds();
    }

    accessibleBusinessIds = accessibleBusinessIds.sort();

    const dbBusinessIds = dbAccessibleBusinessIds.slice().sort();
    const sameAccess = JSON.stringify(dbBusinessIds) === JSON.stringify(accessibleBusinessIds);
    const lastLoginStale = !dbStaff?.lastLogin || (Date.now() - new Date(dbStaff.lastLogin).getTime()) > 30 * 60 * 1000;

    const needsWrite = !dbStaff
      || dbStaff.name !== computedName
      || dbStaff.email !== computedEmail
      || dbStaff.phone !== resolvedPhone
      || dbStaff.role !== roleDb
      || dbStaff.paymentType !== paymentType
      || JSON.stringify(dbStaff.salaryDetails ?? {}) !== JSON.stringify(salaryDetails)
      || JSON.stringify(dbStaff.commissionDetails ?? {}) !== JSON.stringify(commissionDetails)
      || JSON.stringify(dbStaff.permissions ?? {}) !== JSON.stringify(permissions)
      || !sameAccess
      || lastLoginStale;

    let staff: any;
    let staffCode = dbStaff?.staffCode || (publicMetadata.staffCode as string | undefined) || await generateStaffCode();

    if (needsWrite) {
      const getUniqueTargets = (error: any): string[] => {
        if (error?.code !== 'P2002') return [];
        const target = error?.meta?.target;
        if (Array.isArray(target)) return target.map(String);
        if (typeof target === 'string') return [target];
        return [];
      };

      const hasTarget = (targets: string[], field: string) =>
        targets.includes(field) || targets.some((t) => t.toLowerCase().includes(field.toLowerCase()));

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const baseData = {
            name: computedName,
            email: computedEmail,
            phone: resolvedPhone,
            role: roleDb as any,
            staffCode,
            lastLogin: new Date(),
            paymentType,
            salaryDetails: salaryDetails as any,
            commissionDetails: commissionDetails as any,
            permissions: permissions as any,
          };

          const updateData = {
            ...baseData,
            accessibleBusinesses: {
              set: [],
              connect: accessibleBusinessIds.map((id) => ({ id })),
            },
          };

          const createData = {
            ...baseData,
            accessibleBusinesses: {
              connect: accessibleBusinessIds.map((id) => ({ id })),
            },
          };

          staff = await prisma.staffMember.upsert({
            where: { clerkId: userId },
            update: updateData,
            create: {
              clerkId: userId,
              ...createData,
            } as any,
          });
          break;
        } catch (error: any) {
          const targets = getUniqueTargets(error);

          // Staff code conflict: regenerate and retry.
          if (hasTarget(targets, 'staffCode')) {
            staffCode = await generateStaffCode();
            continue;
          }

          // Email/phone conflicts are common when an invite-created record exists.
          // Merge by taking over the existing record and binding it to the current Clerk user.
          if (hasTarget(targets, 'email') || hasTarget(targets, 'phone')) {
            const existing = await prisma.staffMember.findFirst({
              where: {
                OR: [
                  { email: computedEmail },
                  { phone: resolvedPhone },
                ],
              },
            });

            if (existing) {
              const mergedStaffCode = existing.staffCode || staffCode;
              const mergedPhone = existing.phone || resolvedPhone;

              staff = await prisma.staffMember.update({
                where: { id: existing.id },
                data: {
                  name: computedName,
                  email: computedEmail,
                  phone: mergedPhone,
                  role: roleDb as any,
                  clerkId: userId,
                  staffCode: mergedStaffCode,
                  lastLogin: new Date(),
                  paymentType,
                  salaryDetails: salaryDetails as any,
                  commissionDetails: commissionDetails as any,
                  permissions: permissions as any,
                  accessibleBusinesses: {
                    set: [],
                    connect: accessibleBusinessIds.map((id) => ({ id })),
                  },
                },
              });
              break;
            }
          }

          throw error;
        }
      }
    } else {
      staff = dbStaff;
    }

    if (!staff) throw new Error('Failed to retrieve or create staff member.');

    // Write back to Clerk ONLY if metadata changed
    const currentMeta = user.publicMetadata || {};
    const desiredMeta = {
      role,
      staffId: staff.id,
      staffCode: staff.staffCode,
      phone: resolvedPhone,
      paymentType,
      salaryDetails,
      commissionDetails,
      permissions,
      accessibleBusinessIds,
    };

    const metaChanged = JSON.stringify(currentMeta) !== JSON.stringify({ ...currentMeta, ...desiredMeta });

    if (metaChanged) {
      try {
        await client.users.updateUser(userId, {
          publicMetadata: {
            ...currentMeta,
            ...desiredMeta,
          },
        });
      } catch (err) {
        console.warn('[WHOAMI_METADATA_BACKFILL]', err);
      }
    }

    const plainStaff = JSON.parse(JSON.stringify(staff));
    plainStaff.accessibleBusinessIds = accessibleBusinessIds;
    plainStaff.permissions = permissions;

    const result: StaffAuthResult = { status: 'ok', staff: plainStaff };
    await setCachedStaffAuth(userId, result);
    return result;
  } catch (error) {
    console.error('[API_ERROR:WHOAMI]', error);
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      return safeFallback(user);
    } catch (err) {
      console.error('[API_ERROR:WHOAMI_FALLBACK]', err);
      return { status: 'blocked' };
    }
  }
}
