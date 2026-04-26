'use client';

import { useParams } from 'next/navigation';
import { OrderDetailsView } from '@/components/orders/order-details-view';

export default function OrderDetailsPage() {
    const params = useParams();
    const id = params?.id as string;

    return <OrderDetailsView orderId={id} />;
}
