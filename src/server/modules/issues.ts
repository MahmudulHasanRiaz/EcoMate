import prisma from '@/lib/prisma';
import { randomBytes } from 'crypto';
import { Issue, IssuePriority, IssueStatus } from '@/types';
import { revalidatePath } from 'next/cache';
import { notifyAdmins, notifyStaffMember } from './notifications';

export type CreateIssueInput = {
    title: string;
    description: string;
    priority: IssuePriority;
    orderId?: string;
    createdBy: string;
};

export type UpdateIssueInput = Partial<Issue> & {
    comment?: string;
    updatedBy: string;
};

const toPrismaStatus = (status: IssueStatus | string): any => {
    if (status === 'In Progress') return 'In_Progress';
    return status;
};

const toFrontendStatus = (status: any): IssueStatus => {
    if (status === 'In_Progress') return 'In Progress';
    return status as IssueStatus;
};

export async function createIssue(data: CreateIssueInput) {
    const { title, description, priority, orderId, createdBy } = data;

    const issueId = `cm${randomBytes(11).toString('hex')}`;
    const logId = `cm${randomBytes(11).toString('hex')}`;

    const issue = await prisma.issue.create({
        data: {
            id: issueId,
            title,
            description,
            priority: toPrismaStatus(priority),
            orderId: orderId || null,
            createdBy,
            status: 'Open', // Initial status
            IssueLog: {
                create: {
                    id: logId,
                    user: createdBy,
                    action: 'Issue Created.'
                }
            }
        },
        include: {
            IssueLog: true,
            Order: {
                select: {
                    id: true,
                    orderNumber: true
                }
            },
            StaffMember: {
                select: {
                    id: true,
                    name: true
                }
            }
        }
    });

    // Notify Admins and Assigned User
    notifyAdmins(
        `New Issue: ${title}`,
        `Priority: ${priority}${issue.Order?.orderNumber ? ` | Order: #${issue.Order.orderNumber}` : ''}`,
        `/dashboard/issues`,
        'AlertCircle'
    );

    revalidatePath('/dashboard/issues');
    revalidatePath('/dashboard/orders');

    return {
        ...issue,
        orderNumber: issue.Order?.orderNumber || null,
        assignedToName: issue.StaffMember?.name || null,
        status: toFrontendStatus(issue.status),
        priority: issue.priority as IssuePriority,
        createdAt: issue.createdAt.toISOString(),
        resolvedAt: issue.resolvedAt ? issue.resolvedAt.toISOString() : undefined
    };
}

export async function getIssues(filter?: {
    orderId?: string;
    pageSize?: number;
    cursor?: string;
    status?: string | string[];
    priority?: string | string[];
    assignedTo?: string;
    search?: string;
    includeTotal?: boolean;
}) {
    const whereClause: any = {};
    if (filter?.orderId) {
        whereClause.orderId = filter.orderId;
    }

    if (filter?.status && filter.status !== 'all') {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        if (statuses.length > 0) {
            whereClause.status = { in: statuses.map(s => toPrismaStatus(s)) };
        }
    }

    if (filter?.priority && filter.priority !== 'all') {
        const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
        if (priorities.length > 0) {
            whereClause.priority = { in: priorities };
        }
    }

    if (filter?.assignedTo && filter.assignedTo !== 'all') {
        whereClause.assignedTo = filter.assignedTo;
    }

    if (filter?.search) {
        const search = filter.search.trim();
        if (search) {
            whereClause.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
                // Support searching by ID (short or long)
                { id: { contains: search, mode: 'insensitive' } },
                { Order: { orderNumber: { contains: search, mode: 'insensitive' } } },
                // Handle explicit "ISS-" prefix in search if user types it
                ...(search.toUpperCase().startsWith('ISS-') ? [{ id: { endsWith: search.replace(/^ISS-/i, ''), mode: 'insensitive' } }] : [])
            ];
        }
    }

    const pageSize = Math.min(Math.max(1, filter?.pageSize || 20), 100);
    const cursor = filter?.cursor;

    const [total, rawIssues] = await Promise.all([
        filter?.includeTotal ? prisma.issue.count({ where: whereClause }) : Promise.resolve(0),
        prisma.issue.findMany({
            where: whereClause,
            orderBy: [
                { createdAt: 'desc' },
                { id: 'desc' }
            ],
            cursor: cursor ? { id: cursor } : undefined,
            take: pageSize + 1,
            include: {
                Order: {
                    select: {
                        id: true,
                        orderNumber: true
                    }
                },
                StaffMember: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                IssueLog: true
            }
        })
    ]);

    const hasMore = rawIssues.length > pageSize;
    const issues = hasMore ? rawIssues.slice(0, pageSize) : rawIssues;
    let nextCursor: string | null = null;
    if (hasMore) {
        const lastItem = issues[issues.length - 1];
        nextCursor = lastItem.id;
    }

    // Transform to match frontend Issue type
    const items = issues.map(issue => ({
        ...issue,
        orderId: issue.orderId || undefined, // Fix null to undefined
        orderNumber: issue.Order?.orderNumber || null,
        // assignedTo is already the ID from DB
        assignedToName: issue.StaffMember?.name || null, // Optional helper if we extend type
        assignedTo: issue.assignedTo || undefined, // Fix null to undefined
        logs: issue.IssueLog.map(log => ({
            id: log.id,
            timestamp: log.timestamp.toISOString(),
            user: log.user,
            action: log.action
        })),
        status: toFrontendStatus(issue.status),
        priority: issue.priority as IssuePriority,
        createdAt: issue.createdAt.toISOString(),
        resolvedAt: issue.resolvedAt ? issue.resolvedAt.toISOString() : undefined
    }));

    return { items, total, pageSize, nextCursor, hasMore };
}

export async function getIssuesByOrderId(orderId: string) {
    const result = await getIssues({ orderId });
    return result.items;
}

export async function getIssueById(id: string) {
    const issue = await prisma.issue.findUnique({
        where: { id },
        include: {
            IssueLog: { orderBy: { timestamp: 'desc' } },
            Order: true,
            StaffMember: true,
        },
    });

    if (!issue) return null;

    return {
        ...issue,
        orderNumber: issue.Order?.orderNumber || null,
        // assignedTo is ID
        assignedToName: issue.StaffMember?.name || null,
        logs: issue.IssueLog.map(log => ({
            id: log.id,
            timestamp: log.timestamp.toISOString(),
            user: log.user,
            action: log.action
        })),
        status: toFrontendStatus(issue.status),
        priority: issue.priority as IssuePriority,
        createdAt: issue.createdAt.toISOString(),
        resolvedAt: issue.resolvedAt ? issue.resolvedAt.toISOString() : undefined
    };
}

export async function updateIssue(id: string, data: UpdateIssueInput) {
    const { updatedBy, comment, ...updateData } = data;

    const existingIssue = await prisma.issue.findUnique({ where: { id } });
    if (!existingIssue) return null;

    let logAction = '';
    const updates: any = { ...updateData };

    // Map status if present
    if (updates.status) {
        const newPrismaStatus = toPrismaStatus(updates.status);
        if (newPrismaStatus !== existingIssue.status) {
            logAction += `Status changed to ${updates.status}. `;
            updates.status = newPrismaStatus;

            if (updates.status === 'Resolved' || updates.status === 'Closed') {
                updates.resolvedAt = new Date();
            }
        } else {
            delete updates.status; // No change
        }
    }

    if (comment) {
        logAction += `Comment added: "${comment}". `;
    }

    // Handle assignment logic
    if (updates.assignedTo && updates.assignedTo !== existingIssue.assignedTo) {
        logAction += `Assigned to ${updates.assignedTo} (ID). `;
        const staff = await prisma.staffMember.findUnique({ where: { id: updates.assignedTo } });
        if (staff) {
            logAction = logAction.replace(`Assigned to ${updates.assignedTo} (ID).`, `Assigned to ${staff.name}.`);
        }
    } else if (!existingIssue.assignedTo && updates.status && updates.status !== 'Open') {
        // Auto-assign logic could go here
    }

    if (logAction) {
        updates.IssueLog = {
            create: {
                id: `cm${randomBytes(11).toString('hex')}`,
                user: updatedBy,
                action: logAction.trim()
            }
        };
    }

    const updatedIssue = await prisma.issue.update({
        where: { id },
        data: updates,
        include: {
            IssueLog: true,
            StaffMember: true
        }
    });

    // Notify if assignment changed
    if (updates.assignedTo && updates.assignedTo !== existingIssue.assignedTo) {
        notifyStaffMember(
            updates.assignedTo,
            `Assigned Issue: ${updatedIssue.title}`,
            `You have been assigned to this issue. Status: ${toFrontendStatus(updatedIssue.status)}`,
            `/dashboard/issues`,
            'AlertCircle'
        );
    }

    revalidatePath('/dashboard/issues');
    revalidatePath('/dashboard/orders');

    return {
        ...updatedIssue,
        assignedToName: updatedIssue.StaffMember?.name || null,
        status: toFrontendStatus(updatedIssue.status),
        priority: updatedIssue.priority as IssuePriority,
        createdAt: updatedIssue.createdAt.toISOString(),
        resolvedAt: updatedIssue.resolvedAt ? updatedIssue.resolvedAt.toISOString() : undefined
    };
}
