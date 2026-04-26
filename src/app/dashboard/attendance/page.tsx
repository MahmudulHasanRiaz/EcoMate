
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import AttendanceClientPage from './client-page';
import { getGeneralSettings } from '@/server/utils/app-settings';

function AttendancePageSkeleton() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex items-center">
                <Skeleton className="h-10 w-1/3" />
                <div className="flex-1" />
                <div className="flex items-center gap-2">
                    <Skeleton className="h-10 w-48" />
                    <Skeleton className="h-10 w-24" />
                </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-[98px]" />)}
            </div>
            <div className="space-y-6">
                <Skeleton className="h-64 w-full" />
                <Skeleton className="h-64 w-full" />
            </div>
        </div>
    )
}

export default async function AttendancePage() {
    const settings = await getGeneralSettings();
    const timezone = settings.timezone || 'Asia/Dhaka';
    return (
        <Suspense fallback={<AttendancePageSkeleton />}>
            <AttendanceClientPage timezone={timezone} />
        </Suspense>
    );
}
