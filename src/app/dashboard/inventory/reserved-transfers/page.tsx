import { Metadata } from 'next';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { redirect } from 'next/navigation';
import ReservedTransfersClient from './client-page';

export const metadata: Metadata = {
    title: 'Reserved Transfers | Inventory',
};

export default async function ReservedTransfersPage({
    searchParams,
}: {
    searchParams?: Promise<{ fromLocationId?: string | string[] }>;
}) {
    const { allowed } = await enforcePermission('inventory', 'read');
    if (!allowed) redirect('/unauthorized');

    const resolvedSearchParams = searchParams ? await searchParams : undefined;

    const allLocations = await prisma.stockLocation.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
    });

    // Destination is fixed to Packing Section; don't allow selecting it as a source.
    const packing = allLocations.find((l) => l.name.toLowerCase() === 'packing section');
    const locations = packing ? allLocations.filter((l) => l.id !== packing.id) : allLocations;

    // Get default godown id
    const godown = locations.find(
        (l) => l.name.toLowerCase() === 'godown'
    );

    const requestedFromLocationId = Array.isArray(resolvedSearchParams?.fromLocationId)
        ? resolvedSearchParams?.fromLocationId[0]
        : resolvedSearchParams?.fromLocationId;

    const defaultFromId =
        (requestedFromLocationId && locations.some((l) => l.id === requestedFromLocationId)
            ? requestedFromLocationId
            : null) ||
        godown?.id ||
        locations[0]?.id ||
        '';

    return <ReservedTransfersClient locations={locations} defaultFromId={defaultFromId} />;
}
