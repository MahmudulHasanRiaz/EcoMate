import { NextRequest, NextResponse } from 'next/server';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { getTaskById, updateTask, deleteTask, UpdateTaskInput, canManageTasks, canDeleteTasks } from '@/server/modules/tasks';
import { StaffRole } from '@prisma/client';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const auth = await getStaffAuthDetails();
        if (auth.status !== 'ok' || !auth.staff) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const task = await getTaskById(id);
        if (!task) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        // Access Check: Admin/Manager OR Creator OR Assignee
        const isManager = canManageTasks(auth.staff.role as StaffRole);
        const isCreator = task.createdById === auth.staff.id;
        const isAssignee = task.assignedToId === auth.staff.id;

        if (!isManager && !isCreator && !isAssignee) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        return NextResponse.json(task);
    } catch (error) {
        console.error('[API:TASK_GET]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const auth = await getStaffAuthDetails();
        if (auth.status !== 'ok' || !auth.staff) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const task = await getTaskById(id);
        if (!task) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        const role = auth.staff.role as StaffRole;
        const isManager = canManageTasks(role);
        const isCreator = task.createdById === auth.staff.id;
        const isAssignee = task.assignedToId === auth.staff.id;

        if (!isManager && !isCreator && !isAssignee) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        let input: UpdateTaskInput = {
            ...body,
            updatedBy: auth.staff.id
        };

        // RESTRICTION: Non-managers (even creators) can ONLY update status.
        if (!isManager) {
            input = {
                status: body.status,
                updateMessage: body.updateMessage,
                updatedBy: auth.staff.id
            };
        }

        const updated = await updateTask(id, input);
        return NextResponse.json(updated);
    } catch (error) {
        console.error('[API:TASK_PUT]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const auth = await getStaffAuthDetails();
        if (auth.status !== 'ok' || !auth.staff) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const task = await getTaskById(id);
        if (!task) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        const role = auth.staff.role as StaffRole;
        const canDelete = canDeleteTasks(role);
        const isCreator = task.createdById === auth.staff.id;

        // Only users with DELETE permission OR creators can delete
        // Project Manager does NOT have delete permission
        if (!canDelete && !isCreator) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        await deleteTask(id);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[API:TASK_DELETE]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
