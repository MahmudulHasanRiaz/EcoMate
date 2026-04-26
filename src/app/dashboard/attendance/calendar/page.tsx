import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import CalendarClientPage from './client-page';
import { getGeneralSettings } from '@/server/utils/app-settings';
import { getStaffListServer } from '@/server/modules/staff-list';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import type { StaffMemberUI } from '@/types';

function CalendarPageSkeleton() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex items-center">
                <Skeleton className="h-10 w-1/3" />
                <div className="flex-1" />
                <div className="flex items-center gap-2">
                    <Skeleton className="h-10 w-32" />
                    <Skeleton className="h-10 w-32" />
                </div>
            </div>
            <Skeleton className="h-[600px] w-full" />
        </div>
    );
}

export default async function AttendanceCalendarPage() {
    const settings = await getGeneralSettings();
    const timezone = settings.timezone || 'Asia/Dhaka';
    
    const auth = await getStaffAuthDetails();
    const currentUser = auth.status === 'ok' ? auth.staff : null;

    // Fetch staff list for the dropdown only for Admin/Manager
    let staff: StaffMemberUI[] = [];
    const isManagerRole = currentUser && (
        currentUser.role === 'Admin' || 
        currentUser.role === 'Manager' || 
        currentUser.permissions?.attendance?.read === true
    );

    if (isManagerRole) {
        const staffPage = await getStaffListServer({ pageSize: 1000 }).catch(() => ({ items: [] }));
        staff = staffPage.items || [];
    }

    return (
        <Suspense fallback={<CalendarPageSkeleton />}>
            <CalendarClientPage timezone={timezone} staffList={staff} currentUser={currentUser} />
        </Suspense>
    );
}
