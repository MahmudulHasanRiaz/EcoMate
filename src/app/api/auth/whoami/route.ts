import { NextResponse } from 'next/server';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';

// Force Node runtime to avoid edge header/session quirks
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await getStaffAuthDetails();

  if (result.status === 'blocked') {
    return NextResponse.json({ status: 'blocked' }, { status: 403 });
  }

  return NextResponse.json(result);
}
