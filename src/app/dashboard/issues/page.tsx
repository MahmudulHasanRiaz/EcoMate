import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import IssuesClientPage from './client-page';
import { getIssues } from '@/server/modules/issues';
import { getStaffListServer } from '@/server/modules/staff-list';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';

function IssuesPageSkeleton() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex items-center">
                <Skeleton className="h-10 w-1/3" />
                <div className="flex-1" />
                <Skeleton className="h-10 w-24" />
            </div>
            <Skeleton className="h-96 w-full" />
        </div>
    );
}

export const dynamic = 'force-dynamic';

export default async function IssuesPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
    // Cursor-based, so we ignore 'page'. We always fetch the latest/first batch on full reload.
    // Client handles "Load More".
    const sp = await searchParams;
    const pageSize = Number(sp.pageSize) || 20;
    const status = sp.status as string | undefined;
    const priority = sp.priority as string | undefined;
    const assignedTo = sp.assignedTo as string | undefined;
    const search = sp.search as string | undefined;

    const [issuesResponse, staffPage, auth] = await Promise.all([
        getIssues({
            pageSize,
            status,
            priority,
            assignedTo,
            search,
            cursor: undefined, // Always start from top for server render
            includeTotal: true
        }),
        getStaffListServer({ pageSize: 1000 }).catch(() => ({ items: [] })),
        getStaffAuthDetails()
    ]);

    const issuesData = (issuesResponse as any) || { items: [], total: 0, nextCursor: null };
    const currentUser = auth.status === 'ok' ? auth.staff : null;
    const staff = staffPage.items || [];

    return (
        <Suspense fallback={<IssuesPageSkeleton />}>
            <IssuesClientPage
                initialIssues={issuesData.items}
                initialNextCursor={issuesData.nextCursor}
                totalIssues={issuesData.total}
                initialStaff={staff}
                currentUser={currentUser}
            />
        </Suspense>
    );
}
