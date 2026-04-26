import { NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';

export async function POST() {
  try {
    const { userId, sessionClaims } = await auth();
    if (!userId) return NextResponse.json({ message: 'No user' }, { status: 401 });

    const roleInSession = (sessionClaims as any)?.publicMetadata?.role;
    if (roleInSession) {
      return NextResponse.json({ message: 'Role present, no action' }, { status: 200 });
    }

    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const roleInUser = (user.publicMetadata as any)?.role;
    if (roleInUser) {
      return NextResponse.json({ message: 'Role present on user' }, { status: 200 });
    }

    // If no role anywhere, check whether this email has an invite in Clerk
    const primaryEmail = user.emailAddresses?.[0]?.emailAddress;
    if (primaryEmail) {
      const invites = await client.invitations.getInvitationList({ query: primaryEmail });
      const hasInvite = (invites?.data?.length || 0) > 0;
      if (hasInvite) {
        // Leave user intact; admin can set role later
        return NextResponse.json({ message: 'Invite found; awaiting role assignment' });
      }
    }

    await client.users.deleteUser(userId);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('[AUTH_CLEANUP_ERROR]', error);
    return NextResponse.json({ message: 'Cleanup failed' }, { status: 500 });
  }
}
