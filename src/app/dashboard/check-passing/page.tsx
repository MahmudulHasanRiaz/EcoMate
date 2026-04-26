
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import CheckPassingClientPage from './client-page';

function CheckPassingPageSkeleton() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex items-center">
                <Skeleton className="h-10 w-1/4" />
                <div className="flex-1" />
                <Skeleton className="h-10 w-32" />
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
            <Skeleton className="h-96" />
        </div>
    )
}

export default function CheckPassingPage() {
    return (
        <Suspense fallback={<CheckPassingPageSkeleton />}>
            <CheckPassingClientPage />
        </Suspense>
    );
}
