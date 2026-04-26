
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import ProductsClientPage from './client-page';

function ProductsPageSkeleton() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex items-center justify-between">
                <Skeleton className="h-10 w-1/4" />
                <div className="flex items-center gap-2">
                    <Skeleton className="h-10 w-40" />
                    <Skeleton className="h-10 w-32" />
                </div>
            </div>
            <Skeleton className="h-96 w-full" />
        </div>
    );
}

export default function ProductsPage() {
    return (
        <Suspense fallback={<ProductsPageSkeleton />}>
            <ProductsClientPage />
        </Suspense>
    );
}
