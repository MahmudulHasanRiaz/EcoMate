
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import ExpensesClientPage from './client-page';

function ExpensesPageSkeleton() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex items-center justify-between">
                <Skeleton className="h-10 w-1/4" />
                <div className="flex items-center gap-2">
                    <Skeleton className="h-10 w-32" />
                    <Skeleton className="h-10 w-48" />
                    <Skeleton className="h-10 w-32" />
                </div>
            </div>
             <Skeleton className="h-28 w-full" />
            <Skeleton className="h-96 w-full" />
        </div>
    );
}

export default function ExpensesPage() {
    return (
        <Suspense fallback={<ExpensesPageSkeleton />}>
            <ExpensesClientPage />
        </Suspense>
    );
}
