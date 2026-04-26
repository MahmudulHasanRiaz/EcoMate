
'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { getOrderById } from '@/services/orders';
import type { Order } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { StickerTemplate } from '../../sticker-template';

export default function SingleStickerPage() {
    const params = useParams();
    const orderId = params.id as string;
    const [order, setOrder] = React.useState<Order | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);

    React.useEffect(() => {
        if (orderId) {
            getOrderById(orderId).then(data => {
                if (data) {
                    setOrder(data);
                }
                setIsLoading(false);
            });
        }
    }, [orderId]);

    if (isLoading) {
        return (
            <div className="p-10 flex justify-center items-center">
                <Skeleton className="w-[75mm] h-[100mm]" />
            </div>
        );
    }
    
    if (!order) {
        return <div className="p-10 text-center">Order not found.</div>;
    }

    return (
        <div className="bg-gray-200">
            <div className="p-4 bg-white shadow-md no-print sticky top-0 z-10 flex items-center justify-between">
                <h1 className="text-lg font-bold">Sticker Preview</h1>
                <Button onClick={() => window.print()}>
                    <Printer className="mr-2 h-4 w-4" />
                    Print Sticker
                </Button>
            </div>
             <div className="p-10 flex justify-center items-start print:p-0">
                <StickerTemplate order={order} />
            </div>
        </div>
    );
}
