'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { getOrderById } from '@/services/orders';
import type { Order } from '@/types';
import { InvoiceTemplate } from '../invoice-template';
import { StickerTemplate } from '../sticker-template';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export default function BulkInvoicePrintClient() {
    const searchParams = useSearchParams();
    const [orders, setOrders] = React.useState<Order[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const printType = searchParams.get('type');
    const orderIdsParam = searchParams.get('ids');

    React.useEffect(() => {
        const fetchOrders = async () => {
            const token = searchParams.get('token');
            const orderIdsParam = searchParams.get('ids');

            if (!token && !orderIdsParam) {
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            try {
                let orderIds: string[] = [];

                if (token) {
                    const res = await fetch(`/api/print/bulk/${token}`);
                    if (!res.ok) throw new Error('Failed to fetch batch IDs');
                    const data = await res.json();
                    orderIds = data.ids;
                } else if (orderIdsParam) {
                    orderIds = orderIdsParam.split(',');
                }

                if (orderIds.length > 0) {
                    try {
                        const ordersRes = await fetch('/api/print/bulk/orders', {
                            method: 'POST',
                            body: JSON.stringify({ ids: orderIds }),
                            headers: { 'Content-Type': 'application/json' },
                        });
                        if (!ordersRes.ok) throw new Error(`Bulk orders API returned ${ordersRes.status}`);
                        const { orders: fetchedOrders } = await ordersRes.json();
                        setOrders(fetchedOrders);
                    } catch (bulkError) {
                        console.warn("[PRINT_FALLBACK] Bulk fetch failed, falling back to individual getOrderById:", bulkError);
                        const individualOrders = await Promise.all(
                            orderIds.map(id => getOrderById(id.trim()))
                        );
                        setOrders(individualOrders.filter((o): o is Order => !!o));
                    }
                }
            } catch (error) {
                console.error("Failed to fetch orders for bulk print:", error);
                setOrders([]);
            } finally {
                setIsLoading(false);
            }
        };

        fetchOrders();

    }, [searchParams]);

    if (isLoading) {
        return (
            <div className="p-10 text-center">
                <p>Preparing print batch...</p>
                <div className="mt-4 space-y-4">
                    {[...Array(3)].map((_, i) => (
                        <Skeleton key={i} className="h-48 w-full max-w-4xl mx-auto" />
                    ))}
                </div>
            </div>
        )
    }

    if (orders.length === 0) {
        return <div className="p-10 text-center">No orders to print.</div>;
    }

    return (
        <div className="bg-gray-200">
            <div className="p-4 bg-white shadow-md no-print sticky top-0 z-10 flex items-center justify-between">
                <h1 className="text-lg font-bold">
                    Bulk Print: {orders.length} {printType === 'invoice' ? 'Invoices' : 'Stickers'}
                </h1>
                <Button onClick={() => window.print()}>
                    <Printer className="mr-2 h-4 w-4" />
                    Print All
                </Button>
            </div>

            <div className="p-4 print:p-0">
                {printType === 'invoice' && (
                    <div className="space-y-4 print:space-y-0">
                        {orders.map((order, index) => (
                            <div key={`${order.id}-${index}`} className={cn(
                                "bg-white shadow-lg print:shadow-none",
                                index < orders.length - 1 && "page-break"
                            )}>
                                <InvoiceTemplate order={order} />
                            </div>
                        ))}
                    </div>
                )}

                {printType === 'sticker' && (
                    <div className="print-sticker-container grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 print:block">
                        {orders.map((order, index) => (
                            <div key={`${order.id}-${index}`} className={cn(
                                "flex justify-center items-start bg-white shadow-lg print:shadow-none print:w-full print:h-[100mm]",
                                index < orders.length - 1 && "page-break"
                            )}>
                                <StickerTemplate order={order} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <style jsx global>{`
                @media print {
                    .page-break {
                        page-break-after: always;
                    }
                    body {
                        -webkit-print-color-adjust: exact;
                    }
                }
            `}</style>
        </div>
    );
}
