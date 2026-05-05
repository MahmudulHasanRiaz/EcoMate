import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import prisma from '@/lib/prisma';
import { getPresetPermissions } from '@/lib/permissions';
import { attachPageAccess } from '@/lib/page-access';
import { generateStaffCode } from '@server/utils/staffCode';
import { enforcePermission } from '@/lib/security';

const roleMap: Record<string, string> = {
  'Admin': 'Admin',
  'Manager': 'Manager',
  'Packing Assistant': 'PackingAssistant',
  'Moderator': 'Moderator',
  'Seller': 'Seller',
  'Call Assistant': 'CallAssistant',
  'Call Centre Manager': 'CallCentreManager',
  'Courier Manager': 'CourierManager',
  'Courier Call Assistant': 'CourierCallAssistant',
  'Vendor/Supplier': 'Vendor_Supplier',
  'Partner': 'Vendor_Supplier',
  'Cutting Master': 'CuttingMan',
  'Marketer': 'Marketer',
  'Finance Manager': 'FinanceManager',
  'Project Manager': 'ProjectManager',
  'Modarator Manager': 'ModaratorManager',
  'Custom': 'Custom',
};

const roleAliases: Record<string, string> = {
  callcentermanager: 'Call Centre Manager',
  'call centre manager': 'Call Centre Manager',
  modaratormanager: 'Modarator Manager',
  'modarator manager': 'Modarator Manager',
  projectmanager: 'Project Manager',
  'project manager': 'Project Manager',
  callassistant: 'Call Assistant',
  'call assistant': 'Call Assistant',
};

function normalizeUiRole(input: unknown): string | undefined {
  const role = String(input || '').trim();
  if (!role) return undefined;
  if (roleMap[role]) return role;
  const alias = roleAliases[role.toLowerCase()];
  if (alias) return alias;
  return undefined;
}

function getInviteErrorDetails(error: any, pendingInviteCount: number) {
  let status = Number(error?.status) || 500;
  let message = error?.message || 'Failed to create invitation';
  const first = Array.isArray(error?.errors) ? error.errors[0] : null;
  const code = String(first?.code || '').toLowerCase();
  const clerkMessage = first?.longMessage || first?.message;
  if (clerkMessage) message = clerkMessage;

  const normalized = String(message).toLowerCase();

  if (
    status === 429
    || code.includes('too_many')
    || normalized.includes('too many requests')
  ) {
    return {
      status: 429,
      message: 'Too many invitation requests in a short time. Please wait a minute and try again.',
    };
  }

  if (
    code.includes('limit')
    || code.includes('resource_limit')
    || normalized.includes('reached')
    || normalized.includes('limit')
  ) {
    return {
      status: 429,
      message: `Invitation limit reached. Cancel old pending invitations and retry. Pending invites: ${pendingInviteCount}.`,
    };
  }

  if (
    code === 'form_identifier_exists'
    || normalized.includes('already exists')
    || normalized.includes('already been used')
  ) {
    return {
      status: 409,
      message: 'This email already has an account. Use a different email or reset the existing user password.',
    };
  }

  if (normalized.includes('unique constraint')) {
    return {
      status: 409,
      message: 'An invite for this email already exists.',
    };
  }

  return { status, message };
}

async function cleanupExpiredInvites(client: Awaited<ReturnType<typeof clerkClient>>) {
  const expired = await (prisma as any).staffInvite.findMany({
    where: {
      status: 'Pending',
      usedAt: null,
      expiresAt: { lt: new Date() },
    },
    select: { id: true, token: true },
    take: 200,
  });

  if (!expired.length) return;

  for (const invite of expired) {
    if (!invite.token) continue;
    try {
      await client.invitations.revokeInvitation(invite.token);
    } catch (err) {
      console.warn('[STAFF_INVITE_EXPIRED_REVOKE_WARN]', {
        inviteId: invite.id,
        message: (err as any)?.message || String(err),
      });
    }
  }

  await (prisma as any).staffInvite.updateMany({
    where: { id: { in: expired.map((i: any) => i.id) } },
    data: { status: 'Revoked', expiresAt: new Date() },
  });
}

async function revokeSameEmailPendingClerkInvites(
  client: Awaited<ReturnType<typeof clerkClient>>,
  normalizedEmail: string,
) {
  const existing = await client.invitations.getInvitationList({ query: normalizedEmail } as any);
  const rows = Array.isArray((existing as any)?.data) ? (existing as any).data : [];

  for (const inv of rows) {
    const inviteId = String(inv?.id || '').trim();
    const status = String(inv?.status || '').toLowerCase();
    const email = String(inv?.emailAddress || inv?.email_address || '').toLowerCase();
    if (!inviteId) continue;
    if (email && email !== normalizedEmail) continue;
    if (status && status !== 'pending') continue;
    try {
      await client.invitations.revokeInvitation(inviteId);
    } catch (err) {
      console.warn('[STAFF_INVITE_DUPLICATE_REVOKE_WARN]', {
        inviteId,
        email: normalizedEmail,
        message: (err as any)?.message || String(err),
      });
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const { allowed, error } = await enforcePermission('staff', 'create');
    if (!allowed) return error;

    const {
      email,
      name,
      phone,
      role,
      paymentType,
      salaryDetails,
      commissionDetails,
      permissions,
      accessibleBusinessIds = [],
      invitedBy = 'System',
    } = await req.json();

    const resolvedRole = normalizeUiRole(role);

    if (!email || !name || !phone || !resolvedRole) {
      return NextResponse.json({ message: 'email, phone, name, role are required' }, { status: 400 });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:9002';
    const client = await clerkClient();

    // Best-effort housekeeping to reduce stale invite buildup.
    await cleanupExpiredInvites(client).catch((err) => {
      console.warn('[STAFF_INVITE_CLEANUP_WARN]', (err as any)?.message || String(err));
    });

    // Clear any stale invites for the same email to avoid unique constraint collisions
    await prisma.staffInvite.deleteMany({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    });

    // If Clerk still has a pending invite for this email, revoke it first.
    await revokeSameEmailPendingClerkInvites(client, normalizedEmail).catch((err) => {
      console.warn('[STAFF_INVITE_REVOKE_EMAIL_WARN]', {
        email: normalizedEmail,
        message: (err as any)?.message || String(err),
      });
    });

    // Admins get all businesses automatically; others keep the provided subset
    let businessIdsToGrant = accessibleBusinessIds;
    if (resolvedRole === 'Admin') {
      const allBusinesses = await prisma.business.findMany({ select: { id: true } });
      businessIdsToGrant = allBusinesses.map((b) => b.id);
    }

    const basePermissions = resolvedRole === 'Custom' ? permissions : getPresetPermissions(resolvedRole);
    const effectivePermissions = attachPageAccess(basePermissions || {}, resolvedRole);
    const staffCode = await generateStaffCode();

    // Create Clerk invitation (handles email)
    const invitation = await client.invitations.createInvitation({
      emailAddress: normalizedEmail,
      publicMetadata: {
        role: resolvedRole,
        permissions: effectivePermissions,
        accessibleBusinessIds: businessIdsToGrant,
        staffCode,
        paymentType,
        salaryDetails,
        commissionDetails,
        name,
        phone,
      },
      redirectUrl: `${appUrl}/dashboard`,
    });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await (prisma as any).staffInvite.create({
      data: {
        email: normalizedEmail,
        phone,
        role: roleMap[resolvedRole] || 'Custom',
        permissions: effectivePermissions || {},
        businessIds: businessIdsToGrant,
        invitedBy,
        token: invitation.id,
        expiresAt,
        status: 'Pending',
      },
    });

    return NextResponse.json({ inviteId: invitation.id, status: invitation.status, email: normalizedEmail });
  } catch (error: any) {
    console.error('[API_ERROR:STAFF_INVITE]', JSON.stringify(error, null, 2));

    const pendingInviteCount = await (prisma as any).staffInvite
      .count({ where: { status: 'Pending', usedAt: null } })
      .catch(() => 0);
    const details = getInviteErrorDetails(error, pendingInviteCount);
    return NextResponse.json({ message: details.message }, { status: details.status });
  }
}
