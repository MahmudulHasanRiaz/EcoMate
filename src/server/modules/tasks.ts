import prisma from '@/lib/prisma';
import { Task, TaskStatus, TaskPriority, StaffRole } from '@prisma/client';
import { differenceInMinutes } from 'date-fns';

export type CreateTaskInput = {
    title: string;
    description?: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate?: string | Date;
    assignedToId?: string;
    createdById: string;
};

export type UpdateTaskInput = Partial<CreateTaskInput> & {
    updatedBy?: string; // ID of user making the update
    updateMessage?: string; // Optional message from the user
};

// Permission Helpers
export const canManageTasks = (role: StaffRole) =>
    ([StaffRole.Admin, StaffRole.Manager, StaffRole.ProjectManager, StaffRole.CallCentreManager, StaffRole.CourierManager, StaffRole.FinanceManager] as StaffRole[]).includes(role);

// DELETE permission is more restrictive - Only Admin, Manager, and FinanceManager have FULL_ACCESS to tasks
// ProjectManager, CallCentreManager, CourierManager have CREATE_READ_UPDATE only (no delete)
export const canDeleteTasks = (role: StaffRole) =>
    ([StaffRole.Admin, StaffRole.Manager, StaffRole.FinanceManager] as StaffRole[]).includes(role);

export async function getTasks(params: { staffId: string; role: StaffRole; status?: TaskStatus; priority?: TaskPriority }) {
    const { staffId, role, status, priority } = params;

    const where: any = {};

    if (!canManageTasks(role)) {
        where.OR = [
            { assignedToId: staffId },
            { createdById: staffId }
        ];
    }

    if (status) where.status = status;
    if (priority) where.priority = priority;

    const tasks = await prisma.task.findMany({
        where,
        include: {
            StaffMember_Task_assignedToIdToStaffMember: { select: { id: true, name: true, staffCode: true } },
            StaffMember_Task_createdByIdToStaffMember: { select: { id: true, name: true } }
        },
        orderBy: [
            { priority: 'desc' },
            { dueDate: 'asc' },
            { createdAt: 'desc' }
        ]
    });

    return tasks.map((t: any) => ({
        ...t,
        assignedTo: t.StaffMember_Task_assignedToIdToStaffMember ?? null,
        createdBy: t.StaffMember_Task_createdByIdToStaffMember,
    }));
}

export async function getTaskById(id: string) {
    const task = await prisma.task.findUnique({
        where: { id },
        include: {
            StaffMember_Task_assignedToIdToStaffMember: { select: { id: true, name: true, staffCode: true } },
            StaffMember_Task_createdByIdToStaffMember: { select: { id: true, name: true } },
            TaskLog: {
                orderBy: { timestamp: 'desc' },
                include: { StaffMember: { select: { name: true } } }
            }
        }
    });

    if (!task) return null;

    const { TaskLog, StaffMember_Task_assignedToIdToStaffMember, StaffMember_Task_createdByIdToStaffMember, ...rest } = task as any;

    return {
        ...rest,
        assignedTo: StaffMember_Task_assignedToIdToStaffMember ?? null,
        createdBy: StaffMember_Task_createdByIdToStaffMember,
        logs: (TaskLog || []).map((log: any) => ({ ...log, user: log.StaffMember }))
    };
}

export async function createTask(input: CreateTaskInput) {
    return prisma.$transaction(async (tx) => {
        const task = await tx.task.create({
            data: {
                title: input.title,
                description: input.description,
                status: input.status,
                priority: input.priority,
                dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
                assignedToId: input.assignedToId,
                createdById: input.createdById,
                // Time tracking initial state
                startedAt: input.status === 'InProgress' ? new Date() : null,
                completedAt: input.status === 'Done' ? new Date() : null,
            }
        });

        // Log creation
        await tx.taskLog.create({
            data: {
                taskId: task.id,
                userId: input.createdById,
                action: 'Created',
                details: `Task created with status ${input.status}`
            }
        });

        return task;
    });
}

export async function updateTask(id: string, input: UpdateTaskInput) {
    const { updatedBy, updateMessage, ...data } = input;
    if (data.dueDate) data.dueDate = new Date(data.dueDate);

    const oldTask = await prisma.task.findUnique({ where: { id } });
    if (!oldTask) throw new Error("Task not found");

    const changes: string[] = [];
    const timeTrackingUpdate: any = {};
    const updateData: any = {};

    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    if (data.assignedToId !== undefined) updateData.assignedToId = data.assignedToId;

    if (data.status && data.status !== oldTask.status) {
        changes.push(`Status changed from ${oldTask.status} to ${data.status}`);

        // Logic: ToDo -> InProgress = Set StartedAt
        if (data.status === 'InProgress' && !oldTask.startedAt) {
            timeTrackingUpdate.startedAt = new Date();
        }

        // Logic: Any -> Done = Set CompletedAt & Calculate Duration
        if (data.status === 'Done' && oldTask.status !== 'Done') {
            const now = new Date();
            timeTrackingUpdate.completedAt = now;
            const start = oldTask.startedAt || now;
            const duration = Math.max(0, differenceInMinutes(now, start));
            timeTrackingUpdate.totalDuration = duration;
        }

        // Logic: Done -> Any other = clear completedAt
        if (oldTask.status === 'Done' && data.status !== 'Done') {
            timeTrackingUpdate.completedAt = null;
        }
    }

    if (data.assignedToId !== undefined && data.assignedToId !== oldTask.assignedToId) {
        changes.push(`Assignee changed`);
    }

    if (changes.length === 0 && Object.keys(updateData).length > 0) {
        changes.push(`Task details updated`);
    }

    return prisma.$transaction(async (tx) => {
        const updated = await tx.task.update({
            where: { id },
            data: { ...updateData, ...timeTrackingUpdate }
        });

        if (updatedBy && (changes.length > 0 || updateMessage)) {
            await tx.taskLog.create({
                data: {
                    taskId: id,
                    userId: updatedBy,
                    action: 'Updated',
                    details: updateMessage
                        ? `${changes.join(', ') || 'Note added'}. Note: ${updateMessage}`
                        : changes.join(', ')
                }
            });
        }

        return updated;
    });
}

export async function deleteTask(id: string) {
    return prisma.task.delete({
        where: { id }
    });
}

// Reporting Helper
export async function getTaskReport(params: { from: Date; to: Date; staffId?: string }) {
    const { from, to, staffId } = params;

    const where: any = {
        completedAt: { gte: from, lte: to },
        status: 'Done'
    };
    if (staffId) where.assignedToId = staffId;

    const completedTasks = await prisma.task.findMany({
        where,
        select: {
            id: true,
            title: true,
            totalDuration: true,
            completedAt: true,
            StaffMember_Task_assignedToIdToStaffMember: { select: { name: true } }
        }
    });

    const totalTasks = completedTasks.length;
    const totalDuration = completedTasks.reduce((acc, t) => acc + (t.totalDuration || 0), 0);
    const avgDuration = totalTasks > 0 ? Math.round(totalDuration / totalTasks) : 0;

    return {
        metrics: { totalTasks, totalDuration, avgDuration },
        tasks: completedTasks.map((t: any) => ({
            ...t,
            assignedTo: t.StaffMember_Task_assignedToIdToStaffMember ?? null,
        }))
    };
}
