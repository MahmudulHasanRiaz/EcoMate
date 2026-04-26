import { NextRequest, NextResponse } from 'next/server';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { getTaskReport, canManageTasks } from '@/server/modules/tasks';
import { StaffRole } from '@prisma/client';

export async function GET(req: NextRequest) {
    try {
        const auth = await getStaffAuthDetails();
        if (auth.status !== 'ok' || !auth.staff) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Only Admin/Manager can view full reports? 
        // Or maybe regular staff can view their own stats?
        // Let's allow everyone but filter by permission.
        const role = auth.staff.role as StaffRole;
        const isManager = canManageTasks(role);

        const searchParams = req.nextUrl.searchParams;
        const fromStr = searchParams.get('from');
        const toStr = searchParams.get('to');
        const staffIdParam = searchParams.get('staffId');

        if (!fromStr || !toStr) {
            return NextResponse.json({ error: 'Missing date range' }, { status: 400 });
        }

        const from = new Date(fromStr);
        const to = new Date(toStr);

        // If "all" passed (or undefined) and is admin, send undefined to fetch all.
        let targetStaffId: string | undefined = staffIdParam || undefined;
        if (targetStaffId === 'all') targetStaffId = undefined;

        if (!isManager) {
            if (targetStaffId && targetStaffId !== auth.staff.id) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
            targetStaffId = auth.staff.id;
        }

        const report = await getTaskReport({
            from,
            to,
            staffId: targetStaffId
        });

        return NextResponse.json(report);
    } catch (error) {
        console.error('[API:TASK_REPORT]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
