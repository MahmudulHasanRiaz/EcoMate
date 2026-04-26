
import { NextResponse } from 'next/server';
import { getIssueById, updateIssue } from '@/server/modules/issues';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import type { IssuePriority, IssueStatus } from '@/types';
import { enforcePermission } from '@/lib/security';
import prisma from '@/lib/prisma';

export const runtime = 'nodejs';

const allowedStatuses: IssueStatus[] = ['Open', 'In Progress', 'Resolved', 'Closed'];
const allowedPriorities: IssuePriority[] = ['Low', 'Medium', 'High'];

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { allowed, error } = await enforcePermission('issues', 'read');
        if (!allowed) return error;

        const { id } = await params;

        const issue = await getIssueById(id);
        if (!issue) {
            return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
        }

        return NextResponse.json(issue);
    } catch (error) {
        console.error('[API:ISSUE_GET]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { allowed, error } = await enforcePermission('issues', 'update');
        if (!allowed) return error;

        const auth = await getStaffAuthDetails();
        if (auth.status !== 'ok') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { id } = await params;

        const body = await request.json();

        // Extract updatable fields
        const { status, priority, description, assignedTo, comment } = body;

        if (status && !allowedStatuses.includes(status as IssueStatus)) {
            return NextResponse.json({ error: 'Invalid status' }, { status: 422 });
        }
        if (priority && !allowedPriorities.includes(priority as IssuePriority)) {
            return NextResponse.json({ error: 'Invalid priority' }, { status: 422 });
        }

        let normalizedAssignedTo: string | undefined = undefined;
        if (typeof assignedTo === 'string' && assignedTo.trim().length > 0) {
            normalizedAssignedTo = assignedTo.trim();
            const staffExists = await prisma.staffMember.findUnique({
                where: { id: normalizedAssignedTo },
                select: { id: true },
            });
            if (!staffExists) {
                return NextResponse.json({ error: 'Assigned staff not found' }, { status: 404 });
            }
        }

        const updatedIssue = await updateIssue(id, {
            status: status as IssueStatus,
            priority: priority as IssuePriority,
            description,
            assignedTo: normalizedAssignedTo,
            comment,
            updatedBy: auth.staff?.name || auth.staff?.id || 'System'
        });

        if (!updatedIssue) {
            return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
        }

        return NextResponse.json(updatedIssue);
    } catch (error) {
        console.error('[API:ISSUE_PATCH]', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
