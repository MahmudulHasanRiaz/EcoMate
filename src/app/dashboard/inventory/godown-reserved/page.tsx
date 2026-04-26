import { enforcePermission } from '@/lib/security';
import { redirect } from 'next/navigation';

// Deprecated: `reserved-transfers` supports selecting the source location (including Godown).
export default async function GodownReservedPage() {
    const { allowed } = await enforcePermission('inventory', 'read');
    if (!allowed) redirect('/unauthorized');

    redirect('/dashboard/inventory/reserved-transfers');
}
