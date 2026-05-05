import { NextRequest, NextResponse } from 'next/server';
import { WebhookEvent } from '@clerk/nextjs/server';
import { Webhook } from 'svix';
import prisma from '@/lib/prisma';
import { createClerkClient } from '@clerk/backend';
import { getPresetPermissions } from '@/lib/staff-permissions';
import { attachPageAccess } from '@/lib/page-access';
import { generateStaffCode } from '@server/utils/staffCode';
import { normalizeSalaryDetails, normalizeCommissionDetails } from '@server/utils/staff-compensation';

export const runtime = 'nodejs';

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY || '',
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '',
});

const prismaRoleMap: Record<string, string> = {
  'Admin': 'Admin',
  'Manager': 'Manager',
  'Packing Assistant': 'PackingAssistant',
  'Moderator': 'Moderator',
  'Seller': 'Seller',
  'Call Assistant': 'CallAssistant',
  'Call Centre Manager': 'CallCentreManager',
  'Courier Manager': 'CourierManager',
  'Courier Call Assistant': 'CourierCallAssistant',
  'Vendor/Supplier': 'VendorSupplier',
  'Partner': 'VendorSupplier',
  'Project Manager': 'ProjectManager',
  'Modarator Manager': 'ModaratorManager',
  'Sales Representative': 'SalesRepresentative',
  'Custom': 'Custom',
};

const dbRoleToUiRole: Record<string, string> = {
  Admin: 'Admin',
  Manager: 'Manager',
  PackingAssistant: 'Packing Assistant',
  Moderator: 'Moderator',
  Seller: 'Seller',
  CallAssistant: 'Call Assistant',
  CallCentreManager: 'Call Centre Manager',
  CourierManager: 'Courier Manager',
  CourierCallAssistant: 'Courier Call Assistant',
  FinanceManager: 'Finance Manager',
  ModaratorManager: 'Modarator Manager',
  ProjectManager: 'Project Manager',
  SalesRepresentative: 'Sales Representative',
  VendorSupplier: 'Vendor/Supplier',
  Custom: 'Custom',
};

const normalizeEmail = (email?: string | null) => (email ? email.trim().toLowerCase() : undefined);

const toUiRole = (role?: string | null) => {
  if (!role) return undefined;
  return dbRoleToUiRole[role] || role;
};

const normalizeName = (value: unknown) => {
  const name = String(value || '').trim();
  return name.length ? name : undefined;
};

export async function POST(req: NextRequest) {
  try {
    const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
    if (!WEBHOOK_SECRET) {
      return NextResponse.json({ message: 'Missing CLERK_WEBHOOK_SECRET' }, { status: 500 });
    }

    const svixId = req.headers.get('svix-id');
    const svixTimestamp = req.headers.get('svix-timestamp');
    const svixSignature = req.headers.get('svix-signature');

    if (!svixId || !svixTimestamp || !svixSignature) {
      return NextResponse.json({ message: 'Missing webhook signature headers' }, { status: 400 });
    }

    const payloadString = await req.text();
    const wh = new Webhook(WEBHOOK_SECRET);
    let evt: WebhookEvent;
    try {
      evt = wh.verify(payloadString, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      }) as WebhookEvent;
    } catch (err) {
      console.error('[WEBHOOK_ERROR:VERIFY]', err);
      return NextResponse.json({ message: 'Invalid signature' }, { status: 400 });
    }

    const payload = evt;

    if (payload.type === 'user.created') {
      const user = payload.data;
      let staffCode = await generateStaffCode();
      const publicMetadata: any = user.public_metadata || {};

      // Try to hydrate from stored invite if metadata missing/incomplete
      const primaryEmail = normalizeEmail(user.email_addresses?.[0]?.email_address);
      // Pick the latest invite for this email (even if already marked used) to hydrate metadata
      const invite = primaryEmail
        ? await (prisma as any).staffInvite.findFirst({
          where: { email: { equals: primaryEmail, mode: 'insensitive' } },
          orderBy: { createdAt: 'desc' },
        })
        : null;
      const clerkInvites = primaryEmail
        ? await clerk.invitations.getInvitationList({ query: primaryEmail })
        : { data: [] };
      const hasExternalInvite = (clerkInvites?.data?.length || 0) > 0;

      // If no invite and no role provided, block this signup
      let role = toUiRole(publicMetadata.role as string | undefined)
        || toUiRole(invite?.role)
        || (invite ? 'Admin' : undefined);
      if (!invite && !role && !hasExternalInvite) {
        console.warn('[WEBHOOK:user.created] No invite/role; deleting user:', user.id);
        // do not delete here for bootstrap flow; just ignore so first admin cannot be auto-removed
        console.warn('[WEBHOOK:user.created] Ignoring uninvited user (no delete to keep bootstrap safe)');
        return NextResponse.json({ ignored: true });
      }
      // If only external Clerk invite exists, fallback to Custom role
      if (!role) role = 'Custom';

      const phoneFromUser =
        (user as any)?.phone_numbers?.[0]?.phone_number
        || (user as any)?.phoneNumbers?.[0]?.phoneNumber;
      const clerkDisplayName = normalizeName(`${user.first_name || ''} ${user.last_name || ''}`) || undefined;
      const preferredName = normalizeName(publicMetadata.name) || clerkDisplayName || primaryEmail || 'New Staff';
      const phone = (publicMetadata.phone as string | undefined) || phoneFromUser || invite?.phone || '';
      const basePermissions = publicMetadata.permissions || invite?.permissions || getPresetPermissions(role);
      const permissions = attachPageAccess(basePermissions, role);
      const accessibleBusinessIds: string[] = publicMetadata.accessibleBusinessIds || invite?.businessIds || [];
      const paymentType = publicMetadata.paymentType || 'Both';
      const salaryDetails = normalizeSalaryDetails(paymentType, publicMetadata.salaryDetails || invite?.salaryDetails);
      const commissionDetails = normalizeCommissionDetails(paymentType, publicMetadata.commissionDetails || invite?.commissionDetails);

      const validBusinesses = accessibleBusinessIds.length
        ? await prisma.business.findMany({
          where: { id: { in: accessibleBusinessIds } },
          select: { id: true }
        })
        : [];
      const validBusinessIds = validBusinesses.map(b => b.id);

      const isStaffCodeConflict = (error: any) => {
        if (error?.code !== 'P2002') return false;
        const target = error?.meta?.target;
        if (Array.isArray(target)) return target.includes('staffCode');
        return typeof target === 'string' && target.includes('staffCode');
      };

      let staffRecord: any;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          staffRecord = await prisma.staffMember.upsert({
            where: { clerkId: user.id },
            update: {
              staffCode,
              name: preferredName,
              email: primaryEmail || `${user.id}@example.com`,
              role: (prismaRoleMap[role || ''] || 'Custom') as any,
              lastLogin: new Date(),
              phone,
              paymentType,
              salaryDetails: salaryDetails as any,
              commissionDetails: commissionDetails as any,
              permissions: permissions as any,
              accessibleBusinesses: {
                set: [],
                connect: validBusinessIds.map(id => ({ id })),
              },
            } as any,
            create: {
              clerkId: user.id,
              staffCode,
              name: preferredName,
              email: primaryEmail || `${user.id}@example.com`,
              role: (prismaRoleMap[role || ''] || 'Custom') as any,
              lastLogin: new Date(),
              phone,
              paymentType,
              salaryDetails: salaryDetails as any,
              commissionDetails: commissionDetails as any,
              permissions: permissions as any,
              accessibleBusinesses: {
                connect: validBusinessIds.map(id => ({ id })),
              },
            } as any,
          });
          break;
        } catch (error: any) {
          if (!isStaffCodeConflict(error)) throw error;
          staffCode = await generateStaffCode();
        }
      }
      if (!staffRecord) throw new Error('Failed to assign a unique staff code.');

      // Persist full metadata back to Clerk (merge to avoid losing fields)
      const mergedMetadata = {
        ...(user.public_metadata || {}),
        role,
        phone,
        permissions,
        accessibleBusinessIds,
        paymentType,
        salaryDetails,
        commissionDetails,
        name: staffRecord.name,
        staffId: staffRecord.id,
        staffCode,
      };
      await clerk.users.updateUser(user.id, {
        publicMetadata: mergedMetadata,
      }).catch((err) => console.warn('[WEBHOOK_WARNING:UPDATE_METADATA_STAFFID]', err));

      // Mark invite as used & revoke Clerk invitation so it disappears from pending list
      if (invite?.id) {
        await (prisma as any).staffInvite.update({
          where: { id: invite.id },
          data: { usedAt: new Date(), status: 'Accepted' },
        }).catch((err: any) => console.warn('[WEBHOOK_WARNING:MARK_INVITE_USED]', err));
      }
      if (invite?.token) {
        try {
          await clerk.invitations.revokeInvitation(invite.token);
        } catch (err) {
          console.warn('[WEBHOOK_WARNING:REVOKE_INVITATION]', err);
        }
      }
    }

    if (payload.type === 'user.updated') {
      const user = payload.data;
      const publicMetadata: any = user.public_metadata || {};
      const primaryEmail = normalizeEmail(user.email_addresses?.[0]?.email_address);
      const hasMeta = (key: string) => Object.prototype.hasOwnProperty.call(publicMetadata, key);
      const invite = primaryEmail
        ? await (prisma as any).staffInvite.findFirst({
          where: { email: { equals: primaryEmail, mode: 'insensitive' }, usedAt: null },
          orderBy: { createdAt: 'desc' },
        })
        : null;
      const staff = await prisma.staffMember.findFirst({
        where: { clerkId: user.id },
        include: { accessibleBusinesses: true },
      });

      const roleFromMeta = hasMeta('role') ? toUiRole(publicMetadata.role as string | undefined) : undefined;
      const staffRoleUi = staff?.role ? (dbRoleToUiRole[staff.role] || staff.role) : undefined;
      const role = staffRoleUi || roleFromMeta || toUiRole(invite?.role) || (invite ? 'Admin' : undefined) || 'Custom';
      const staffPhone = staff?.phone && !staff.phone.startsWith('temp-') ? staff.phone : undefined;
      const phone = staffPhone
        || (hasMeta('phone') ? publicMetadata.phone : undefined)
        || invite?.phone
        || staff?.phone
        || '';
      const basePermissions = staff?.permissions
        || (hasMeta('permissions') ? publicMetadata.permissions : undefined)
        || invite?.permissions
        || getPresetPermissions(role || 'Custom');
      const permissions = attachPageAccess(basePermissions as any, role);
      const accessibleBusinessIds: string[] = staff?.accessibleBusinesses?.map((b) => b.id)
        || (hasMeta('accessibleBusinessIds') ? publicMetadata.accessibleBusinessIds : undefined)
        || invite?.businessIds
        || [];
      const paymentType = staff?.paymentType
        || (hasMeta('paymentType') ? publicMetadata.paymentType : undefined)
        || invite?.paymentType
        || 'Both';
      const salarySource = staff?.salaryDetails
        || (hasMeta('salaryDetails') ? publicMetadata.salaryDetails : undefined)
        || invite?.salaryDetails;
      const commissionSource = staff?.commissionDetails
        || (hasMeta('commissionDetails') ? publicMetadata.commissionDetails : undefined)
        || invite?.commissionDetails;
      const salaryDetails = normalizeSalaryDetails(paymentType, salarySource);
      const commissionDetails = normalizeCommissionDetails(paymentType, commissionSource);
      const canonicalName = normalizeName(publicMetadata.name)
        || normalizeName(staff?.name)
        || normalizeName(`${user.first_name || ''} ${user.last_name || ''}`)
        || user.email_addresses?.[0]?.email_address
        || 'Updated Staff';

      await clerk.users.updateUser(user.id, {
        publicMetadata: {
          ...(user.public_metadata || {}),
          name: canonicalName,
          role,
          phone,
          permissions,
          accessibleBusinessIds,
          paymentType,
          salaryDetails,
          commissionDetails,
        },
      });

      if (staff) {
        // Validate accessibleBusinessIds before connecting to avoid P2025
        const validBusinesses = accessibleBusinessIds.length
          ? await prisma.business.findMany({
            where: { id: { in: accessibleBusinessIds } },
            select: { id: true }
          })
          : [];
        const validBusinessIds = validBusinesses.map(b => b.id);
        const dbRole = staff.role
          || (roleFromMeta ? (prismaRoleMap[roleFromMeta] || 'Custom') : 'Custom');

        await prisma.staffMember.update({
          where: { id: staff.id },
          data: {
            name: canonicalName,
            email: user.email_addresses?.[0]?.email_address || `${user.id}@example.com`,
            role: dbRole as any,
            phone: phone || '',
            paymentType,
            salaryDetails: salaryDetails as any,
            commissionDetails: commissionDetails as any,
            permissions: permissions as any,
            accessibleBusinesses: validBusinessIds.length
              ? {
                set: [],
                connect: validBusinessIds.map(id => ({ id })),
              }
              : { set: [] },
          } as any,
        });
      }
    }

    if (payload.type === 'user.deleted') {
      const user = payload.data;
      await prisma.staffMember.deleteMany({
        where: { clerkId: user.id },
      });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[WEBHOOK_ERROR:CLERK]', error);
    return NextResponse.json({ message: 'Webhook error' }, { status: 500 });
  }
}
