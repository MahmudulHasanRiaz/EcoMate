import { Suspense } from 'react';
import ProcurementClientPage from './client-page';
import { Skeleton } from '@/components/ui/skeleton';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Wholesale Procurement | EcoMate',
  description: 'Manage demand and procurement for external brands.',
};

export default async function ProcurementPage() {
  const auth = await getStaffAuthDetails();
  if (auth.status !== 'ok') redirect('/sign-in');
  
  const allowedRoles = ['SuperAdmin', 'Admin', 'Manager'];
  if (!allowedRoles.includes(auth.staff.role)) {
    redirect('/unauthorized');
  }

  return (
    <Suspense fallback={<ProcurementSkeleton />}>
      <ProcurementClientPage />
    </Suspense>
  );
}

function ProcurementSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-24" />
      </div>
      <Skeleton className="h-[400px] w-full" />
    </div>
  );
}
