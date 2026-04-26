import { NextRequest, NextResponse } from 'next/server';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { getTasks, createTask, CreateTaskInput, canManageTasks } from '@/server/modules/tasks';
import { StaffRole, TaskStatus, TaskPriority } from '@prisma/client';

export async function GET(req: NextRequest) {
    try {
        const auth = await getStaffAuthDetails();
        if (auth.status !== 'ok' || !auth.staff) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const role = auth.staff.role as StaffRole;
        const status = req.nextUrl.searchParams.get('status') as TaskStatus | undefined;
        const priority = req.nextUrl.searchParams.get('priority') as TaskPriority | undefined;

        // Fetch tasks based on role and filters
        const tasks = await getTasks({
            staffId: auth.staff.id,
            role,
            status,
            priority
        });

        return NextResponse.json(tasks);
    } catch (error) {
        console.error('[API:TASKS_GET]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const auth = await getStaffAuthDetails();
        if (auth.status !== 'ok' || !auth.staff) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const role = auth.staff.role as StaffRole;
        const body = await req.json();

        // Enforce assignment policy: Non-managers can only assign to themselves (or auto-assigned)
        let assignedToId = body.assignedToId;
        if (!canManageTasks(role)) {
            assignedToId = auth.staff.id;
        }

        const input: CreateTaskInput = {
            ...body,
            assignedToId,
            createdById: auth.staff.id,
        };

        const task = await createTask(input);
        return NextResponse.json(task);
    } catch (error) {
        console.error('[API:TASKS_POST]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
