
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import CourierReportClientPage from './client-page';

function CourierReportPageSkeleton() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <Skeleton className="h-10 w-1/3" />
            <Skeleton className="h-28 w-full max-w-2xl mx-auto" />
            <div className="space-y-4 mt-6 max-w-2xl mx-auto">
                <Skeleton className="h-44 w-full" />
                <Skeleton className="h-32 w-full" />
            </div>
        </div>
    )
}

export default function CourierReportPage() {
    return (
        <Suspense fallback={<CourierReportPageSkeleton />}>
            <CourierReportClientPage />
        </Suspense>
    );
}
