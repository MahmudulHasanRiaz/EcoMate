
'use client';

import * as React from 'react';
import Image from 'next/image';
import { getOrders, updateOrder } from '@/services/orders';
import type { Order, OrderProduct, OrderStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Clock, Images, Package, Printer, ScanBarcode } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

type PackingOrderStatus = 'Confirmed' | 'Packing Hold';

const statusColors: Record<PackingOrderStatus, string> = {
    'Confirmed': 'bg-sky-500/20 text-sky-700',
    'Packing Hold': 'bg-amber-500/20 text-amber-700',
};


function OrderCard({ order, onStatusChange }: { order: Order, onStatusChange: (orderId: string, newStatus: OrderStatus) => void }) {
    const [isUpdating, setIsUpdating] = React.useState(false);
        const flattenedProducts = React.useMemo(() => {
        const result: any[] = [];
        order.products.forEach(product => {
            if (product.isCombo && product.componentBreakdown && Array.isArray(product.componentBreakdown)) {
                product.componentBreakdown.forEach((comp: any) => {
                    result.push({
                        ...comp,
                        productId: comp.productId || product.productId,
                        isComboComponent: true,
                        comboName: product.name,
                        name: comp.name || 'Combo Component',
                        variantName: comp.variantName,
                        variantImage: comp.variantImage,
                        variantSku: comp.variantSku || comp.sku,
                        quantity: comp.quantity,
                    });
                });
            } else {
                result.push({
                    ...product,
                    isComboComponent: false,
                });
            }
        });
        return result;
    }, [order.products]);

    const imageItems = React.useMemo(() => {
        return flattenedProducts.map(product => ({
            src: product.variantImage || product.image?.imageUrl || '/logo-icon.svg',
            alt: product.variantName || product.name,
            label: product.isComboComponent ? ` (in )` : product.variantName || product.name,
            sku: product.variantSku || product.sku || 'N/A',
            quantity: product.quantity,
        }));
    }, [flattenedProducts]);

    const handleDone = async () => {
        setIsUpdating(true);
        await onStatusChange(order.id, 'RTS (Ready to Ship)');
        setIsUpdating(false);
    };

    const handleHold = async () => {
        setIsUpdating(true);
        await onStatusChange(order.id, 'Packing Hold');
        setIsUpdating(false);
    };

    const handlePrint = (e: React.MouseEvent) => {
        e.stopPropagation();
        window.open(`/print/sticker/${order.id}`, '_blank');
    };

    return (
        <Card className="overflow-hidden border-2 shadow-md">
            <CardHeader className="flex flex-row items-center justify-between bg-muted/30 p-3">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center text-primary">
                        <Package className="w-6 h-6" />
                    </div>
                    <div>
                        <CardTitle className="text-base font-bold">#{order.orderNumber || order.id.slice(-6)}</CardTitle>
                        <p className="text-[11px] text-muted-foreground uppercase">{order.customerName}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={handlePrint}
                    >
                        <Printer className="h-4 w-4" />
                    </Button>
                    <Badge className={cn("text-[10px]", statusColors[order.status as PackingOrderStatus] || 'bg-gray-500/20 text-gray-700')}>
                        {order.status}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="p-3">
                <div className="space-y-3">
                    {imageItems.length > 0 && (
                        <div className="flex justify-end">
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button variant="outline" size="sm" className="h-8 gap-1 px-2 text-[11px]">
                                        <Images className="h-4 w-4" />
                                        View Photos
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-4xl">
                                    <DialogHeader>
                                        <DialogTitle>Order Photos</DialogTitle>
                                    </DialogHeader>
                                    <div className="max-h-[70vh] overflow-y-auto pr-1">
                                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                            {imageItems.map((item, index) => (
                                                <div key={`${item.sku}-${index}`} className="rounded-xl border bg-white p-3">
                                                    <div className="relative overflow-hidden rounded-lg border bg-muted">
                                                        <Image
                                                            src={item.src}
                                                            alt={item.alt}
                                                            width={360}
                                                            height={270}
                                                            className="h-40 w-full object-cover sm:h-44"
                                                        />
                                                    </div>
                                                    <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                                                        <span className="truncate font-semibold">{item.label}</span>
                                                        <Badge variant="secondary" className="text-[10px]">x{item.quantity}</Badge>
                                                    </div>
                                                    <p className="text-[10px] text-muted-foreground">SKU: {item.sku}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </DialogContent>
                            </Dialog>
                        </div>
                    )}
                    {flattenedProducts.map(product => (
                        <div key={product.productId} className="flex items-center gap-3 bg-slate-50 p-2 rounded-lg border border-slate-100">
                            <div className="relative shrink-0">
                                <Image
                                    src={product.variantImage || product.image?.imageUrl || '/logo-icon.svg'}
                                    alt={product.variantName || product.name}
                                    width={80}
                                    height={80}
                                    className="h-20 w-20 rounded-md object-cover aspect-square border bg-white sm:h-14 sm:w-14"
                                />
                                <Badge className="absolute -top-2 -right-2 px-1.5 h-5 min-w-[20px] justify-center text-[10px]">{product.quantity}</Badge>
                            </div>
                                                        <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-bold truncate">{product.name}</p>
                                    {product.isComboComponent && <Badge variant="secondary" className="text-[10px] scale-75 transform origin-left">Combo Item</Badge>}
                                </div>
                                {product.variantName ? (
                                    <p className="text-[11px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-sm inline-block mt-0.5 mb-1 truncate max-w-full">
                                        Var: {product.variantName}
                                    </p>
                                ) : (product.productType === 'variable' ? (
                                    <p className="text-[11px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-sm inline-block mt-0.5 mb-1 truncate max-w-full">
                                        ⚠️ MISSING VARIANT
                                    </p>
                                ) : null)}
                                <p className="text-[10px] text-muted-foreground mt-0.5">SKU: {product.variantSku || product.sku || 'N/A'}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
            <CardFooter className="p-3 grid grid-cols-2 gap-3 bg-muted/10">
                <Button variant="outline" size="lg" className="w-full text-xs font-bold" onClick={handleHold} disabled={isUpdating}>
                    <Clock className="mr-2 h-4 w-4" />
                    HOLD
                </Button>
                <Button size="lg" className="w-full text-xs font-bold bg-green-600 hover:bg-green-700" onClick={handleDone} disabled={isUpdating}>
                    <Check className="mr-2 h-4 w-4" />
                    DONE
                </Button>
            </CardFooter>
        </Card>
    )
}


// Helper hook for paginated tab data
function usePackingTab(status: PackingOrderStatus) {
    const { toast } = useToast();
    const [orders, setOrders] = React.useState<Order[]>([]);
    const [nextCursor, setNextCursor] = React.useState<string | null>(null);
    const [totalCount, setTotalCount] = React.useState<number>(0);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isLoadingMore, setIsLoadingMore] = React.useState(false);

    const loadOrders = React.useCallback(async (reset = false) => {
        if (reset) setIsLoading(true);
        else setIsLoadingMore(true);

        try {
            const data = await getOrders({
                status,
                pageSize: 20,
                includeTotal: true,
                cursor: reset ? undefined : (nextCursor || undefined),
                packingView: true,
            });
            const list = (data as any)?.items ?? data ?? [];
            setOrders(prev => {
                if (reset) return list;
                const seen = new Set(prev.map(o => o.id));
                return [...prev, ...list.filter((o: Order) => !seen.has(o.id))];
            });
            setNextCursor((data as any)?.nextCursor ?? null);
            if ((data as any)?.total !== undefined) setTotalCount((data as any).total);
        } catch (error: any) {
            console.error('Failed to load packing orders:', error);
            toast({
                variant: 'destructive',
                title: 'Access Denied',
                description: "You do not have permission to view these orders.",
            });
        } finally {
            if (reset) setIsLoading(false);
            else setIsLoadingMore(false);
        }
    }, [status, nextCursor, toast]);

    // Initial load
    React.useEffect(() => {
        loadOrders(true);
    }, []);

    const hasMore = !!nextCursor;
    return { orders, setOrders, isLoading, isLoadingMore, loadMore: () => loadOrders(false), hasMore, totalCount };
}

export default function PackingOrdersClientPage() {
    const { toast } = useToast();
    const [scanBuffer, setScanBuffer] = React.useState('');
    const [activeTab, setActiveTab] = React.useState('confirmed');

    // Separate state for tabs
    const confirmed = usePackingTab('Confirmed');
    const onHold = usePackingTab('Packing Hold');

    // Consolidated list for scanner lookup
    const allKnownOrders = [...confirmed.orders, ...onHold.orders];

    // Filtered orders: EXCLUDE combo-only orders from this view
    const filteredConfirmed = confirmed.orders;

    const filteredOnHold = onHold.orders;

    // Scanner Listener Logic
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                if (scanBuffer.length > 5) {
                    processScan(scanBuffer);
                }
                setScanBuffer('');
            } else if (e.key.length === 1) {
                setScanBuffer(prev => prev + e.key);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [scanBuffer, allKnownOrders]);

    const handleStatusChange = async (orderId: string, newStatus: OrderStatus) => {
        // Optimistic update
        const sourceTab = activeTab === 'confirmed' ? confirmed : onHold;
        const previousOrders = [...sourceTab.orders];

        // Remove from current tab
        sourceTab.setOrders(prev => prev.filter(o => o.id !== orderId));

        try {
            await updateOrder(orderId, { status: newStatus });
            toast({
                title: newStatus === 'RTS (Ready to Ship)' ? "Packed Successfully" : "Order on Hold",
                description: `Order ${orderId} status updated.`,
            });
        } catch (error: any) {
            sourceTab.setOrders(previousOrders); // Revert
            toast({
                variant: "destructive",
                title: "Error",
                description: error?.message || "Could not update status.",
            });
        }
    };

    const processScan = (code: string) => {
        const order = allKnownOrders.find(o => o.id === code || o.orderNumber === code);
        if (order) {
            handleStatusChange(order.id, 'RTS (Ready to Ship)');
        } else {
            toast({
                variant: 'destructive',
                title: "Scan Error",
                description: `Order not found in loaded list: ${code}`,
            });
        }
    };

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 bg-slate-50/50 min-h-screen">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-black flex items-center gap-2 tracking-tight">
                        <Package className="w-8 h-8 text-primary" />
                        PACKING
                    </h1>
                    <p className="text-sm text-muted-foreground font-medium">
                        System ready for scanning. <kbd className="px-1.5 py-0.5 rounded border bg-white ml-1 text-[10px]">Auto-Confirm</kbd>
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                        <span className="text-[11px] font-bold text-emerald-700">SCANNER ACTIVE</span>
                        <ScanBarcode className="w-4 h-4 text-emerald-600" />
                    </div>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 h-12 bg-white border border-slate-200 shadow-sm p-1 rounded-xl">
                    <TabsTrigger value="confirmed" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-bold text-xs uppercase tracking-wider">
                        Ready to Pack
                        <Badge variant="secondary" className="ml-2 font-black">{confirmed.totalCount}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="on-hold" className="rounded-lg data-[state=active]:bg-amber-500 data-[state=active]:text-white font-bold text-xs uppercase tracking-wider">
                        On Hold
                        <Badge variant="destructive" className="ml-2 font-black border-none">{onHold.totalCount}</Badge>
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="confirmed" className="mt-6">
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {confirmed.isLoading ? (
                            [...Array(6)].map((_, i) => <Skeleton key={i} className="h-[280px] w-full rounded-2xl" />)
                        ) : filteredConfirmed.length > 0 ? (
                            <>
                                {filteredConfirmed.map(order => (
                                    <OrderCard key={order.id} order={order} onStatusChange={handleStatusChange} />
                                ))}
                                {confirmed.hasMore && (
                                    <div className="col-span-full flex justify-center py-6 pb-20 sm:pb-6">
                                        <Button variant="outline" size="lg" className="w-full max-w-xs" onClick={confirmed.loadMore} disabled={confirmed.isLoadingMore}>
                                            {confirmed.isLoadingMore ? 'Loading...' : `Load More (${filteredConfirmed.length} of ${confirmed.totalCount})`}
                                        </Button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="col-span-full text-center py-20 bg-white rounded-3xl border-2 border-dashed border-slate-200">
                                <Package className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                                <p className="font-bold text-slate-500">All orders packed! High five!</p>
                            </div>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="on-hold" className="mt-6">
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {onHold.isLoading ? (
                            [...Array(2)].map((_, i) => <Skeleton key={i} className="h-[280px] w-full rounded-2xl" />)
                        ) : filteredOnHold.length > 0 ? (
                            <>
                                {filteredOnHold.map(order => (
                                    <OrderCard key={order.id} order={order} onStatusChange={handleStatusChange} />
                                ))}
                                {onHold.hasMore && (
                                    <div className="col-span-full flex justify-center py-6 pb-20 sm:pb-6">
                                        <Button variant="outline" size="lg" className="w-full max-w-xs" onClick={onHold.loadMore} disabled={onHold.isLoadingMore}>
                                            {onHold.isLoadingMore ? 'Loading...' : `Load More (${filteredOnHold.length} of ${onHold.totalCount})`}
                                        </Button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="col-span-full text-center py-20 bg-white rounded-3xl border-2 border-dashed border-slate-200">
                                <Clock className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                                <p className="font-bold text-slate-500">No orders on hold.</p>
                            </div>
                        )}
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}




