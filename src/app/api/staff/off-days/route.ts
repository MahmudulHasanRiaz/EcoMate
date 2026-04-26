import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getAuth } from '@clerk/nextjs/server';
import type { NextRequest } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { getGeneralSettings } from '@/server/utils/app-settings';

export async function GET(req: NextRequest) {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Security Guard
    const { allowed, error } = await enforcePermission('staff', 'read');
    if (!allowed) return error;

    const settings = await getGeneralSettings();
    const globalWeekendDays = settings.weekendDays || [5, 6];

    const workType = req.nextUrl.searchParams.get('workType') || 'Office';

    const where: any = {};
    if (workType !== 'all') {
      where.workType = workType;
    }

    const staff = await prisma.staffMember.findMany({
      where,
      select: {
        id: true,
        name: true,
        designation: true,
        workType: true,
        weekendDays: true,
      },
      orderBy: { name: 'asc' },
    });

    const results = staff.map(s => ({
      ...s,
      effectiveWeekendDays: (Array.isArray(s.weekendDays) && s.weekendDays.length > 0)
        ? s.weekendDays
        : globalWeekendDays,
    }));

    return NextResponse.json(results);
  } catch (error: any) {
    console.error('[OFF_DAYS_GET]', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch off days' }, { status: 500 });
  }
}
