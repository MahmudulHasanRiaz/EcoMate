import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import DashboardLayoutClient from './layout-client';
import { getBrandingSettings, getGeneralSettings } from '@/server/utils/app-settings';
import { ensureStockStatusAuditFallback } from '@/server/modules/stock-sync';
import React from 'react';

// Force dynamic rendering to avoid build-time DB calls for dashboard routes
export const dynamic = 'force-dynamic';

// Server Component - fetches permissions server-side
export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Fetch permissions on server directy (fast, no network delay, full auth context)
    let initialPermissions = null;
    let initialAuthState: 'loading' | 'authenticated' | 'blocked' = 'loading';

    let brandingSettings = {
        standardLogoUrl: '/logo-full.svg',
        iconLogoUrl: '/logo-icon.svg',
    };
    let generalSettings: { theme?: 'light' | 'dark' | 'system' } = { theme: 'system' };
    try {
        brandingSettings = await getBrandingSettings();
        generalSettings = await getGeneralSettings();
    } catch (error) {
        console.warn('[DASHBOARD_SETTINGS_FALLBACK]', error);
    }
    try {
        const authResult = await getStaffAuthDetails();

        if (authResult.status === 'blocked') {
            initialAuthState = 'blocked';
        } else {
            initialPermissions = authResult.staff.permissions || null;
            initialAuthState = 'authenticated';
            const role = authResult.staff.role as string | undefined;
            if (role === 'Admin' || role === 'Manager') {
                await ensureStockStatusAuditFallback();
            }
        }
    } catch (error) {
        console.error('[LAYOUT_SERVER_ERROR]', error);
        // Fallback to client-side fetch if server fails
        initialAuthState = 'loading';
    }

    return (
        <>
            <link rel="preload" as="image" href={brandingSettings.iconLogoUrl || brandingSettings.standardLogoUrl || '/logo-icon.svg'} />
            <Suspense fallback={<SidebarSkeleton />}>
                <DashboardLayoutClient
                    initialPermissions={initialPermissions}
                    initialAuthState={initialAuthState}
                    generalSettings={generalSettings}
                    brandingSettings={brandingSettings}
                >
                    {children}
                </DashboardLayoutClient>
            </Suspense>
        </>
    );
}

function SidebarSkeleton() {
    return (
        <div className="grid fixed inset-0 h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr] overflow-hidden bg-background">
            <div className="hidden border-r bg-muted/40 md:block md:h-full">
                <div className="flex h-full max-h-screen flex-col gap-4 p-4">
                    <Skeleton className="h-8 w-32" />
                    <div className="space-y-3">
                        {[...Array(7)].map((_, idx) => (
                            <Skeleton key={idx} className="h-6 w-full" />
                        ))}
                    </div>
                </div>
            </div>
            <div className="flex flex-col h-full overflow-hidden">
                <header className="flex h-14 items-center gap-4 border-b bg-muted px-4 lg:h-[60px] lg:px-6">
                    <Skeleton className="h-8 w-8 rounded-md md:hidden" />
                    <Skeleton className="h-6 w-32" />
                </header>
                <main className="flex-1 bg-background p-6 space-y-4 overflow-y-auto">
                    <Skeleton className="h-10 w-3/4 max-w-xl" />
                    <Skeleton className="h-64 w-full" />
                    <Skeleton className="h-10 w-1/3 max-w-sm" />
                </main>
            </div>
        </div>
    );
}
