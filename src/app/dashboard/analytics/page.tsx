
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import AnalyticsClientPage from './client-page';

function AnalyticsPageSkeleton() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <Skeleton className="h-12 w-1/3" />
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
                {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-[126px]" />)}
            </div>
             <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
                <Skeleton className="lg:col-span-3 h-[400px]" />
                <Skeleton className="lg:col-span-2 h-[400px]" />
            </div>
             <Skeleton className="h-[300px]" />
        </div>
    )
}


export default function AnalyticsPage() {
    return (
        <Suspense fallback={<AnalyticsPageSkeleton />}>
            <AnalyticsClientPage />
        </Suspense>
    );
}
