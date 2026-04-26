
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import PurchasesClientPage from './client-page';
export const dynamic = 'force-dynamic';

function PurchasesPageSkeleton() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <Skeleton className="h-8 w-2/3 sm:h-10 sm:w-1/4" />
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    <Skeleton className="h-10 w-full sm:w-48" />
                    <Skeleton className="h-10 w-full sm:w-40" />
                </div>
            </div>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
            <Skeleton className="h-96 w-full" />
        </div>
    );
}

export default function PurchasesPage() {
    return (
        <Suspense fallback={<PurchasesPageSkeleton />}>
            <PurchasesClientPage />
        </Suspense>
    );
}
