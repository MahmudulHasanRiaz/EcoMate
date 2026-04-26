
'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { getOrderById } from '@/services/orders';
import type { Order } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { InvoiceTemplate } from '../../invoice-template';


export default function SingleInvoicePage() {
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
            <div className="max-w-4xl mx-auto p-8">
                <Skeleton className="h-24 w-full mb-8" />
                <Skeleton className="h-16 w-1/2 mb-8" />
                <Skeleton className="h-48 w-full mb-8" />
                <Skeleton className="h-32 w-1/3 ml-auto" />
            </div>
        );
    }
    
    if (!order) {
        return <div className="p-10 text-center">Order not found.</div>;
    }

    return (
        <div>
             <div className="p-4 bg-white shadow-md no-print sticky top-0 z-10 flex items-center justify-between">
                <h1 className="text-lg font-bold">Invoice Preview</h1>
                <Button onClick={() => window.print()}>
                    <Printer className="mr-2 h-4 w-4" />
                    Print Invoice
                </Button>
            </div>
            <div className="p-4 print:p-0">
                <InvoiceTemplate order={order} />
            </div>
        </div>
    );
}
