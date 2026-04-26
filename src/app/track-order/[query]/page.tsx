'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { getOrderById, getOrdersByCustomerPhone } from '@/services/orders';
import type { Order, OrderProduct } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft } from 'lucide-react';
import { format } from 'date-fns';
import { OrderTimeline } from '@/components/ui/order-timeline';
import { cn } from '@/lib/utils';

const statusColors: Partial<Record<Order['status'], string>> = {
    'New': 'bg-blue-500/20 text-blue-700 dark:text-blue-300',
    'Confirmed': 'bg-sky-500/20 text-sky-700 dark:text-sky-300',
    'Confirmed Waiting': 'bg-teal-500/20 text-teal-700',
    'Packing Hold': 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
    'Canceled': 'bg-red-500/20 text-red-700 dark:text-red-300',
    'C2C': 'bg-red-500/20 text-red-700 dark:text-red-300',
    'Hold': 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300',
    'In-Courier': 'bg-orange-500/20 text-orange-700 dark:text-orange-300',
    'RTS (Ready to Ship)': 'bg-purple-500/20 text-purple-700 dark:text-purple-300',
    'Shipped': 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
    'Delivered': 'bg-green-500/20 text-green-700 dark:text-green-300',
    'Return Pending': 'bg-pink-500/20 text-pink-700 dark:text-pink-300',
    'Returned': 'bg-gray-500/20 text-gray-700 dark:text-gray-300',
    'Paid_Return': 'bg-gray-500/20 text-gray-700 dark:text-gray-300',
    'Paid Return': 'bg-gray-500/20 text-gray-700 dark:text-gray-300',
    'Partial': 'bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300',
    'Incomplete': 'bg-gray-500/20 text-gray-700 dark:text-gray-300',
    'Incomplete-Cancelled': 'bg-red-500/20 text-red-700 dark:text-red-300',
    'Draft': 'bg-zinc-500/20 text-zinc-700 dark:text-zinc-300',
    'Damaged': 'bg-rose-500/20 text-rose-700 dark:text-rose-300',
    'No Response': 'bg-orange-400/20 text-orange-700 dark:text-orange-300',
};

const getStatusColor = (status: Order['status']) => statusColors[status] || 'bg-slate-500/20 text-slate-700 dark:text-slate-300';


function OrderDetailsView({ order }: { order: Order }) {
    const subtotal = order.products.reduce((acc, p) => acc + p.price * p.quantity, 0);
    const shipping = Number(order.shipping || 0);
    const siteDiscountTotal = order.products.reduce((sum, p) => sum + Number((p as any).siteDiscount || 0), 0);
    const fallbackTotal = subtotal + shipping - Number(order.discount || 0) - siteDiscountTotal;
    const total = Number.isFinite(Number(order.total)) ? Number(order.total) : fallbackTotal;
    const effectiveDiscount = Math.max(subtotal + shipping - total, 0);
    const paidAmount = Number(order.paidAmount || 0);
    const shippingPaidAmount = order.shippingPaid ? Number(order.shippingPaidAmount || 0) : 0;
    const totalPaid = paidAmount + shippingPaidAmount;
    const amountDue = Math.max(total - totalPaid, 0);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">{order.orderNumber || 'N/A'}</h1>
                    <p className="text-muted-foreground">Order placed on {format(new Date(order.date), "MMMM d, yyyy")}</p>
                </div>
                <Badge
                    variant="outline"
                    className={cn('ml-auto sm:ml-0 text-lg py-1 px-4', getStatusColor(order.status))}
                >
                    {order.status}
                </Badge>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Order Items</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {order.products.map(product => (
                                    <div key={product.productId} className="flex items-center gap-4">
                                        <Image
                                            src={product.image.imageUrl}
                                            alt={product.name}
                                            width={64}
                                            height={64}
                                            className="rounded-md object-cover aspect-square border"
                                        />
                                        <div className="flex-1">
                                            <p className="font-medium">{product.name}</p>
                                            <p className="text-sm text-muted-foreground">Qty: {product.quantity}</p>
                                        </div>
                                        <p className="font-mono">৳{(product.price * product.quantity).toFixed(2)}</p>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Payment Summary</CardTitle>
                        </CardHeader>
                        <CardContent className='space-y-2 text-sm'>
                            <div className="flex items-center justify-between">
                                <dt className="text-muted-foreground">Subtotal</dt>
                                <dd className="font-mono">৳{subtotal.toFixed(2)}</dd>
                            </div>
                            <div className="flex items-center justify-between">
                                <dt className="text-muted-foreground">Shipping</dt>
                                <dd className="font-mono">৳{shipping.toFixed(2)}</dd>
                            </div>
                            {effectiveDiscount > 0 && (
                                <div className="flex items-center justify-between">
                                    <dt className="text-muted-foreground">Discount</dt>
                                    <dd className="font-mono text-red-500">-৳{effectiveDiscount.toFixed(2)}</dd>
                                </div>
                            )}
                            {siteDiscountTotal > 0 && (
                                <div className="flex items-center justify-between">
                                    <dt className="text-muted-foreground">Site Discount</dt>
                                    <dd className="font-mono text-red-500">-৳{siteDiscountTotal.toFixed(2)}</dd>
                                </div>
                            )}
                            <Separator />
                            <div className="flex items-center justify-between font-semibold">
                                <dt>Total</dt>
                                <dd className="font-mono">৳{total.toFixed(2)}</dd>
                            </div>
                            <div className="flex items-center justify-between">
                                <dt className="text-muted-foreground">Paid</dt>
                                <dd className="font-mono text-green-600">৳{paidAmount.toFixed(2)}</dd>
                            </div>
                            {shippingPaidAmount > 0 && (
                                <div className="flex items-center justify-between">
                                    <dt className="text-muted-foreground">Shipping Paid</dt>
                                    <dd className="font-mono text-green-600">৳{shippingPaidAmount.toFixed(2)}</dd>
                                </div>
                            )}
                            <div className="flex items-center justify-between font-semibold">
                                <dt className={cn(amountDue > 0 && "text-destructive")}>Amount Due</dt>
                                <dd className={cn("font-mono", amountDue > 0 && "text-destructive")}>৳{amountDue.toFixed(2)}</dd>
                            </div>
                        </CardContent>
                    </Card>
                </div>
                <div className="lg:col-span-1">
                    <Card>
                        <CardHeader>
                            <CardTitle>Order History</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <OrderTimeline logs={order.logs} />
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

function OrderListView({ orders }: { orders: Order[] }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Your Orders</CardTitle>
                <CardDescription>We found multiple orders associated with your phone number. Select an order to view its tracking details.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="border rounded-md">
                    {orders.map((order, index) => (
                        <Link
                            href={`/track-order/${order.orderNumber || order.id}`}
                            key={order.id}
                            className="block hover:bg-muted/50"
                        >
                            <div className="flex items-center justify-between p-4">
                                <div>
                                    <p className="font-semibold">{order.orderNumber || 'N/A'}</p>
                                    <p className="text-sm text-muted-foreground">
                                        {format(new Date(order.date), "MMMM d, yyyy")} - {order.products.length} item(s)
                                    </p>
                                </div>
                                <Badge variant="outline" className={cn(getStatusColor(order.status))}>
                                    {order.status}
                                </Badge>
                            </div>
                            {index < orders.length - 1 && <Separator />}
                        </Link>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}

function LoadingView() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <Skeleton className="h-8 w-48 mb-2" />
                    <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-10 w-28 rounded-full" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                    <Skeleton className="h-48 w-full" />
                    <Skeleton className="h-48 w-full" />
                </div>
                <div className="lg:col-span-1">
                    <Skeleton className="h-96 w-full" />
                </div>
            </div>
        </div>
    )
}

function NotFoundView({ query }: { query: string }) {
    return (
        <div className="text-center py-16">
            <h2 className="text-2xl font-bold">Not Found</h2>
            <p className="text-muted-foreground mt-2">
                We couldn't find any order with the ID or phone number: <strong>{query}</strong>
            </p>
            <Button asChild className="mt-6">
                <Link href="/track-order">
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    Try Another Search
                </Link>
            </Button>
        </div>
    )
}


export default function OrderTrackingResultPage() {
    const params = useParams();
    const query = params.query as string;

    const [order, setOrder] = React.useState<Order | null>(null);
    const [orders, setOrders] = React.useState<Order[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [searchType, setSearchType] = React.useState<'orderId' | 'phone' | 'notFound'>('orderId');

    React.useEffect(() => {
        if (!query) return;
        setIsLoading(true);

        const isPhoneNumber = /^[0-9+]+$/.test(query) && query.length >= 11;

        if (isPhoneNumber) {
            setSearchType('phone');
            getOrdersByCustomerPhone(query).then(data => {
                if (data.length > 0) {
                    setOrders(data);
                } else {
                    setSearchType('notFound');
                }
                setIsLoading(false);
            });
        } else {
            setSearchType('orderId');
            getOrderById(query).then(data => {
                if (data) {
                    setOrder(data);
                } else {
                    setSearchType('notFound');
                }
                setIsLoading(false);
            });
        }
    }, [query]);

    return (
        <div className="container mx-auto w-full max-w-6xl py-8 px-4 sm:px-8">
            <div className="mb-6">
                <Button variant="outline" size="sm" asChild>
                    <Link href="/track-order">
                        <ChevronLeft className="mr-2 h-4 w-4" />
                        New Search
                    </Link>
                </Button>
            </div>

            {isLoading && <LoadingView />}

            {!isLoading && searchType === 'orderId' && order && <OrderDetailsView order={order} />}
            {!isLoading && searchType === 'phone' && orders.length > 0 && <OrderListView orders={orders} />}
            {!isLoading && searchType === 'notFound' && <NotFoundView query={query} />}
        </div>
    );
}

