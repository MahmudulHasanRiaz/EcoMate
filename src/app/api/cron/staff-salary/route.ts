import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureSalaryAccrualsForStaff } from '@/server/utils/staff-salary-accrual';
import { getAppTimezone } from '@/lib/timezone';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[CRON_ERROR] CRON_SECRET is not configured');
    return NextResponse.json({ ok: false, error: 'Configuration error' }, { status: 500 });
  }

  const header = req.headers.get('x-cron-secret');
  if (header !== secret) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const timeZone = await getAppTimezone();
    const BATCH_SIZE = 200;
    let cursor: string | undefined;
    let createdCount = 0;

    while (true) {
      const staff = await prisma.staffMember.findMany({
        take: BATCH_SIZE,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { id: 'asc' },
        select: {
          id: true,
          paymentType: true,
          salaryDetails: true,
          createdAt: true,
          jobStartDate: true,
          jobEndDate: true,
        },
      });

      if (staff.length === 0) break;

      for (const member of staff) {
        createdCount += await ensureSalaryAccrualsForStaff(
          {
            id: member.id,
            paymentType: member.paymentType,
            salaryDetails: member.salaryDetails,
            createdAt: member.createdAt,
            jobStartDate: member.jobStartDate,
            jobEndDate: member.jobEndDate,
          },
          { timeZone },
        );
      }

      cursor = staff[staff.length - 1]?.id;
      if (staff.length < BATCH_SIZE) break;
    }

    return NextResponse.json({ ok: true, created: createdCount });
  } catch (err: any) {
    console.error('[STAFF_SALARY_CRON_ERROR]', err);
    return NextResponse.json({ ok: false, error: err?.message || 'Salary accrual failed' }, { status: 500 });
  }
}
