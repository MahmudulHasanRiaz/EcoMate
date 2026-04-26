import { Metadata } from 'next';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { redirect } from 'next/navigation';
import POSReportsClient from './client-page';

export const metadata: Metadata = {
    title: 'POS Reports',
};

export default async function POSReportsPage() {
    const { allowed, staff } = await enforcePermission('orders', 'read');
    if (!allowed || !staff) redirect('/unauthorized');

    // Fetch accessible showrooms
    const access = await prisma.showroomAccess.findMany({
        where: { staffId: staff.id, Showroom: { isActive: true } },
        include: { Showroom: { select: { id: true, name: true } } },
    });

    let showrooms = access.map((a) => a.Showroom);
    
    // Admin sees all
    if (staff.role === 'Admin') {
        showrooms = await prisma.showroom.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        });
    }

    // Fetch staff for filter
    const staffList = await prisma.staffMember.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
    });

    return <POSReportsClient showrooms={showrooms} staffList={staffList} />;
}
