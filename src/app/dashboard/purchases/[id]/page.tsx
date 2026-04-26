
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { getPurchaseOrderById } from '@/services/purchases';
import { getSuppliers, getVendors, getPartnerOverviewStats } from '@/services/partners';
import { getInventoryLots, getStockLocations } from '@/services/inventory';
import { getStaffListServer } from '@/server/modules/staff-list';
import PurchaseOrderDetailsClientPage from './client-page';
import { getBrandingSettings, getGeneralSettings } from '@/server/utils/app-settings';

function PurchaseOrderDetailsPageSkeleton() {
    return (
        <div className="flex flex-1 flex-col gap-8 p-4 lg:gap-6 lg:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-64" />
                    <Skeleton className="h-4 w-48" />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    <Skeleton className="h-9 w-full sm:w-24" />
                </div>
            </div>

            <Skeleton className="h-32 w-full" />

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
                <div className="space-y-8 lg:col-span-4 xl:col-span-3">
                    <Skeleton className="h-48 w-full" />
                    <Skeleton className="h-64 w-full" />
                    <Skeleton className="h-80 w-full" />
                </div>
                <div className="space-y-8 lg:col-span-8 xl:col-span-9">
                    <Skeleton className="h-80 w-full" />
                    <Skeleton className="h-80 w-full" />
                    <Skeleton className="h-64 w-full" />
                </div>
            </div>
        </div>
    );
}

export default async function PurchaseOrderDetailsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id: poId } = await params;

    // Fetch all required data on the server
    const purchaseOrderData = await getPurchaseOrderById(poId);
    if (!purchaseOrderData) {
        return <div>Purchase Order not found</div>;
    }
    const [
        suppliersData,
        vendorsData,
        locationsData,
        brandingSettings,
        generalSettings,
        cuttingMastersData,
        partnerStats
    ] = await Promise.all([
        getSuppliers(),
        getVendors({ pageSize: 1000 }),
        getStockLocations(),
        getBrandingSettings(),
        getGeneralSettings(),
        getStaffListServer({ role: 'CuttingMan', pageSize: 1000 }),
        getPartnerOverviewStats(),
    ]);

    return (
        <Suspense fallback={<PurchaseOrderDetailsPageSkeleton />}>
            <PurchaseOrderDetailsClientPage
                initialPurchaseOrder={purchaseOrderData}
                suppliers={suppliersData.items}
                vendors={vendorsData.items}
                stockLocations={locationsData}
                // inventoryLots={[]} // Removed full load, client should fetch/search or we pass empty and implement search
                brandingSettings={brandingSettings}
                generalSettings={generalSettings}
                cuttingMasters={cuttingMastersData.items}
                partnerStats={partnerStats?.allStats || []}
            />
        </Suspense>
    );
}
