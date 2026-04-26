import { NextResponse } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { getStaffListServer } from '@/server/modules/staff-list';

export async function GET() {
  const { allowed, error } = await enforcePermission('orders', 'read');
  if (!allowed) return error;

  const data = await getStaffListServer({
    page: 1,
    pageSize: 1000,
    includeInvites: false,
  });

  return NextResponse.json(data.items || []);
}
