import { Suspense } from 'react';
import NewIssueClientPage from './client-page';
import { Skeleton } from '@/components/ui/skeleton';

export const dynamic = 'force-dynamic';

export default function NewIssuePage() {
    return (
        <Suspense fallback={<div className="flex flex-1 justify-center px-4 py-8"><Skeleton className="h-[600px] w-full max-w-2xl" /></div>}>
            <NewIssueClientPage />
        </Suspense>
    );
}
