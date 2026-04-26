
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import IssueDetailsClientPage from './client-page';
import { getIssueById } from '@/server/modules/issues';
import { getStaff } from '@/services/staff';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';

function IssuePageSkeleton() {
    return (
        <div className="p-6">
            <Skeleton className="h-8 w-1/4 mb-6" />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <Skeleton className="h-48 w-full" />
                    <Skeleton className="h-56 w-full" />
                </div>
                <div className="lg:col-span-1">
                    <Skeleton className="h-64 w-full" />
                </div>
            </div>
        </div>
    );
}

export const dynamic = 'force-dynamic';

export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
    // Await params for Next 15 comaptibility
    const { id } = await params;

    const [issue, staffPage, auth] = await Promise.all([
        getIssueById(id),
        getStaff().catch(() => ({ items: [] })),
        getStaffAuthDetails()
    ]);

    if (!issue) {
        notFound();
    }

    const currentUser = auth.status === 'ok' ? auth.staff : null;
    const staff = staffPage.items || [];

    return (
        <Suspense fallback={<IssuePageSkeleton />}>
            <IssueDetailsClientPage
                initialIssue={issue as any}
                initialStaff={staff}
                currentUser={currentUser}
            />
        </Suspense>
    );
}
