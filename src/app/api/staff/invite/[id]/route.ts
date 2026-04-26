import { NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { apiError, apiServerError, apiSuccess } from '@/lib/error';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { allowed, error } = await enforcePermission('staff', 'create');
    if (!allowed) return error;

    const { id } = await params;
    if (!id) return apiError('Invite ID is required', 400);

    const invite = await (prisma as any).staffInvite.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        token: true,
        usedAt: true,
        status: true,
      },
    });

    if (!invite) return apiError('Invite not found', 404);

    if (invite.usedAt || invite.status !== 'Pending') {
      return apiError('Only pending invites can be cancelled', 409);
    }

    if (invite.token) {
      try {
        const clerk = await clerkClient();
        await clerk.invitations.revokeInvitation(invite.token);
      } catch (err: any) {
        // Keep DB revoke robust even if Clerk invite already expired/revoked.
        console.warn('[STAFF_INVITE_REVOKE_CLERK_WARN]', {
          inviteId: id,
          message: err?.message || String(err),
        });
      }
    }

    await (prisma as any).staffInvite.update({
      where: { id },
      data: {
        status: 'Revoked',
        expiresAt: new Date(),
      },
    });

    return apiSuccess({ id, email: invite.email }, 'Invitation cancelled');
  } catch (error) {
    console.error('[API_ERROR:STAFF_INVITE_CANCEL]', error);
    return apiServerError(error);
  }
}

