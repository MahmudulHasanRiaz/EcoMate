
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import CustomersClientPage from './client-page';

function CustomersPageSkeleton() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex items-center justify-between">
                <Skeleton className="h-10 w-1/4" />
                <div className="flex items-center gap-2">
                    <Skeleton className="h-10 w-48" />
                    <Skeleton className="h-10 w-32" />
                </div>
            </div>
            <div className="grid gap-4 grid-cols-2">
                <Skeleton className="h-[98px]" />
                <Skeleton className="h-[98px]" />
            </div>
            <Skeleton className="h-96 w-full" />
        </div>
    );
}

export default function CustomersPage() {
    return (
        <Suspense fallback={<CustomersPageSkeleton />}>
            <CustomersClientPage />
        </Suspense>
    );
}
