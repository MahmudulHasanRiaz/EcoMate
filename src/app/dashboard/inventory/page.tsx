
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import InventoryClientPage from './client-page';

function InventoryPageSkeleton() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <Skeleton className="h-10 w-1/4" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
            <Skeleton className="h-96 w-full" />
        </div>
    );
}

export default function InventoryPage() {
    return (
        <Suspense fallback={<InventoryPageSkeleton />}>
            <InventoryClientPage />
        </Suspense>
    );
}
