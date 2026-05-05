import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import BrandsClientPage from './client-page';

function BrandsPageSkeleton() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex items-center justify-between">
                <Skeleton className="h-10 w-1/4" />
                <Skeleton className="h-10 w-32" />
            </div>
            <Skeleton className="h-96 w-full" />
        </div>
    );
}

export default function BrandsPage() {
    return (
        <Suspense fallback={<BrandsPageSkeleton />}>
            <BrandsClientPage />
        </Suspense>
    );
}
