import { Metadata } from 'next';
import prisma from '@/lib/prisma';
import ShowroomsClient from './client';
import { enforcePermission } from '@/lib/security';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
    title: 'Showrooms | Settings',
};

export default async function ShowroomsPage() {
    const { allowed } = await enforcePermission('settings', 'read');
    if (!allowed) redirect('/unauthorized');

    const showrooms = await prisma.showroom.findMany({
        include: {
            StockLocation: true,
            CashDrawer: true,
            Accesses: {
                include: { StaffMember: { select: { id: true, name: true, phone: true } } }
            }
        },
        orderBy: { createdAt: 'desc' }
    });

    // Collect IDs already used by existing showrooms (both @unique in schema)
    const usedLocationIds = new Set(showrooms.map(s => s.locationId));
    const usedCashDrawerIds = new Set(showrooms.map(s => s.cashDrawerId));

    const allLocations = await prisma.stockLocation.findMany({ select: { id: true, name: true } });
    const allCashDrawers = await prisma.cashDrawer.findMany({ select: { id: true, name: true } });
    const staff = await prisma.staffMember.findMany({ select: { id: true, name: true, phone: true } });

    return (
        <ShowroomsClient 
            initialData={showrooms as any} 
            locations={allLocations}
            cashDrawers={allCashDrawers}
            staff={staff}
            usedLocationIds={Array.from(usedLocationIds)}
            usedCashDrawerIds={Array.from(usedCashDrawerIds)}
        />
    );
}
