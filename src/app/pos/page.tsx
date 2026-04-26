import { Metadata } from 'next';
import prisma from '@/lib/prisma';
import POSClient from './client';
import { enforcePermission } from '@/lib/security';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
    title: 'POS | Showroom',
};

export default async function POSPage() {
    const { allowed, staff } = await enforcePermission("orders", "create");
    if (!allowed || !staff) redirect('/unauthorized');

    // Fetch authorized showrooms for this staff
    const access = await prisma.showroomAccess.findMany({
        where: { staffId: staff.id, Showroom: { isActive: true } },
        include: { Showroom: true }
    });

    const showrooms = access.map(a => a.Showroom);

    const staffBusinesses = await prisma.staffMember.findUnique({
        where: { id: staff.id },
        select: {
            accessibleBusinesses: {
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
            },
        },
    }).catch(() => null);

    const businesses =
        staffBusinesses?.accessibleBusinesses?.length
            ? staffBusinesses.accessibleBusinesses
            : await prisma.business.findMany({
                select: { id: true, name: true },
                orderBy: { name: 'asc' },
            });

    return (
        <POSClient 
            showrooms={showrooms} 
            businesses={businesses}
        />
    );
}
