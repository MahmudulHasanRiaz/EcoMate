import { Suspense } from 'react';
import StockAuditClientPage from './client-page';
import { getStockLocations } from '@/services/inventory';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata = {
    title: 'Stock Audit | Inventory',
    description: 'Perform physical stock counts and adjustments.',
};

export const dynamic = 'force-dynamic';

export default async function StockAuditPage() {
    const locations = await getStockLocations();

    return (
        <div className="container mx-auto py-6">
            <Suspense fallback={<Skeleton className="h-[600px]" />}>
                <StockAuditClientPage locations={locations} />
            </Suspense>
        </div>
    );
}
