
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import PackingOrdersClientPage from './client-page';

function PackingOrdersPageSkeleton() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <Skeleton className="h-12 w-1/3" />
            <Skeleton className="h-10 w-full" />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 mt-4">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-[300px] w-full" />)}
            </div>
        </div>
    );
}

export default function PackingOrdersPage() {
    return (
        <Suspense fallback={<PackingOrdersPageSkeleton />}>
            <PackingOrdersClientPage />
        </Suspense>
    );
}
