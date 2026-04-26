'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search, Save, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StockLocation, InventoryItem } from '@/types';
import { getAuditItems } from '@/services/inventory';
import { adjustStock } from '../actions';
import { useVirtualizer } from '@tanstack/react-virtual';

type AuditItem = InventoryItem & {
    productName: string;
    variantName?: string;
    sku: string;
    category: string;
};

type StockAuditClientPageProps = {
    locations: StockLocation[];
};

export default function StockAuditClientPage({ locations }: StockAuditClientPageProps) {
    const { toast } = useToast();
    const [selectedLocation, setSelectedLocation] = React.useState<string>(locations[0]?.id || '');
    const [items, setItems] = React.useState<AuditItem[]>([]);
    const [cursor, setCursor] = React.useState<string | null>(null);
    const [isLoading, setIsLoading] = React.useState(false);
    const [isLoadingMore, setIsLoadingMore] = React.useState(false);
    const [search, setSearch] = React.useState('');
    const [counts, setCounts] = React.useState<Record<string, number>>({});
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [hasChanges, setHasChanges] = React.useState(false);

    // Debounced search
    const [query, setQuery] = React.useState('');
    React.useEffect(() => {
        const handler = setTimeout(() => setQuery(search), 300);
        return () => clearTimeout(handler);
    }, [search]);

    // Fetch Items Helper
    const loadItems = React.useCallback(async (reset: boolean = false) => {
        if (!selectedLocation) return;
        if (reset) setIsLoading(true);
        else setIsLoadingMore(true);

        try {
            const currentCursor = reset ? undefined : cursor;
            if (!reset && !currentCursor) return;

            const data = await getAuditItems({
                locationId: selectedLocation,
                search: query,
                cursor: currentCursor || undefined,
                pageSize: 50
            });

            if (data && Array.isArray(data.items)) {
                const mappedItems = data.items.map((item: any) => ({
                    ...item,
                    category: item.category ?? ''
                }));
                setItems(prev => reset ? mappedItems : [...prev, ...mappedItems]);
                setCursor(data.nextCursor);
            } else {
                // Fallback if something goes wrong or API shape differs locally
                setItems(prev => reset ? [] : prev);
            }

            if (reset) {
                setCounts({});
                setHasChanges(false);
            }
        } catch (err) {
            toast({ title: 'Error loading items', description: 'Failed to fetch inventory.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
            setIsLoadingMore(false);
        }
    }, [selectedLocation, query, cursor, toast]);

    // Initial Load / Reset
    React.useEffect(() => {
        loadItems(true);
    }, [selectedLocation, query]);

    // Handle Input Change
    const handleCountChange = (itemId: string, value: string) => {
        const num = parseInt(value);
        if (isNaN(num)) return;
        setCounts(prev => ({ ...prev, [itemId]: num }));
        setHasChanges(true);
    };

    // Submit Logic
    const handleSubmit = async () => {
        const updates = Object.entries(counts).map(([itemId, newQty]) => {
            const item = items.find(i => i.id === itemId);
            if (!item) return null;
            if (item.quantity === newQty) return null; // No change
            return {
                id: itemId,
                productId: item.productId,
                variantId: item.variantId,
                locationId: item.locationId,
                currentQty: item.quantity,
                newQty,
                reason: 'Stock Audit'
            };
        }).filter(Boolean);

        if (updates.length === 0) {
            toast({ title: 'No changes', description: 'No quantity differences found.' });
            return;
        }

        setIsSubmitting(true);
        try {
            // We reuse the server action "adjustStock" but we might need a bulk version.
            // For now, let's loop parallel promises or create a bulk action if needed. 
            // Given Phase 13 requirements, simple loop is acceptable for MVP, 
            // but a new "bulkAdjustStock" server action would be better.
            // Let's iterate for now to reuse valid logic.

            let successCount = 0;
            let failCount = 0;

            await Promise.all(updates.map(async (u) => {
                if (!u) return;
                const diff = u.newQty - u.currentQty;
                const res = await adjustStock({
                    productId: u.productId,
                    variantId: u.variantId,
                    locationId: u.locationId,
                    inventoryItemId: u.id,
                    quantityChange: Math.abs(diff),
                    adjustmentType: diff > 0 ? 'add' : 'remove',
                    reason: 'Stock Audit',
                    reference: 'AUDIT-' + new Date().toISOString().split('T')[0],
                    notes: `Audit correction: was ${u.currentQty}, now ${u.newQty}`,
                    user: 'Stock Audit'
                });
                if (res.success) successCount++;
                else failCount++;
            }));

            toast({
                title: 'Audit Submitted',
                description: `Successfully updated ${successCount} items. ${failCount > 0 ? `${failCount} failed.` : ''}`,
                variant: failCount > 0 ? 'destructive' : 'default'
            });

            // Refetch
            // Refetch
            await loadItems(true);
            setCounts({});
            setHasChanges(false);

        } catch (err) {
            toast({ title: 'System Error', description: 'Failed to submit audit updates.', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    // Virtualization
    const parentRef = React.useRef<HTMLDivElement>(null);

    const rowVirtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 60, // approximate row height
        overscan: 10,
    });

    return (
        <div className="flex flex-col gap-6 h-[calc(100vh-120px)]">
            {/* Header Control */}
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between shrink-0">
                <div>
                    <h1 className="text-2xl font-bold font-headline">Stock Audit</h1>
                    <p className="text-muted-foreground">Reconcile physical inventory with system records.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                        <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="Select Location" />
                        </SelectTrigger>
                        <SelectContent>
                            {locations.map(loc => (
                                <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        onClick={handleSubmit}
                        disabled={!hasChanges || isSubmitting}
                        className="gap-2"
                    >
                        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                        <Save className="h-4 w-4" />
                        Save Adjustments
                    </Button>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="flex items-center gap-4 shrink-0">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name, SKU, or category..."
                        className="pl-8"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <Badge variant="secondary" className="h-9 px-4 text-sm font-medium">
                    {items.length} Items Found
                </Badge>
            </div>

            {/* List Area */}
            <Card className="flex-1 overflow-hidden flex flex-col">
                <div className="bg-muted/40 border-b p-3 grid grid-cols-12 gap-4 text-sm font-medium text-muted-foreground shrink-0 pr-6">
                    <div className="col-span-4">Item Details</div>
                    <div className="col-span-2">Lot/Bin</div>
                    <div className="col-span-2 text-right">System Qty</div>
                    <div className="col-span-2 text-right">Physical Count</div>
                    <div className="col-span-2 text-right">Difference</div>
                </div>

                <div ref={parentRef} className="flex-1 overflow-auto">
                    <div
                        style={{
                            height: `${rowVirtualizer.getTotalSize()}px`,
                            width: '100%',
                            position: 'relative'
                        }}
                    >
                        {isLoading ? (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            rowVirtualizer.getVirtualItems().map((virtualRow) => {
                                const item = items[virtualRow.index];
                                const currentQty = item.quantity;
                                const countedQty = counts[item.id] ?? currentQty;
                                const diff = countedQty - currentQty;
                                const hasDiff = diff !== 0;

                                return (
                                    <div
                                        key={virtualRow.key}
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '100%',
                                            height: `${virtualRow.size}px`,
                                            transform: `translateY(${virtualRow.start}px)`,
                                        }}
                                        className={cn(
                                            "grid grid-cols-12 gap-4 p-3 items-center border-b hover:bg-muted/10 transition-colors text-sm",
                                            hasDiff ? "bg-amber-500/5 hover:bg-amber-500/10" : ""
                                        )}
                                    >
                                        <div className="col-span-4 flex flex-col truncate pr-2">
                                            <span className="font-medium truncate">{item.productName}</span>
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <span className="font-mono">{item.sku}</span>
                                                {item.variantName && <span>• {item.variantName}</span>}
                                            </div>
                                        </div>

                                        <div className="col-span-2 text-xs text-muted-foreground truncate">
                                            {item.lotNumber}
                                        </div>

                                        <div className="col-span-2 text-right font-mono">
                                            {currentQty}
                                        </div>

                                        <div className="col-span-2 flex justify-end">
                                            <Input
                                                type="number"
                                                value={counts[item.id] ?? currentQty}
                                                onChange={(e) => handleCountChange(item.id, e.target.value)}
                                                className={cn(
                                                    "h-8 w-24 text-right font-mono",
                                                    hasDiff ? "border-amber-500 bg-amber-50" : ""
                                                )}
                                            />
                                        </div>

                                        <div className={cn("col-span-2 text-right font-mono font-bold",
                                            diff > 0 ? "text-green-600" : diff < 0 ? "text-red-600" : "text-muted-foreground"
                                        )}>
                                            {diff > 0 ? '+' : ''}{diff !== 0 ? diff : '-'}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
                {cursor && (
                    <div className="p-2 border-t bg-muted/20 flex justify-center">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => loadItems(false)}
                            disabled={isLoadingMore}
                        >
                            {isLoadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Load More
                        </Button>
                    </div>
                )}
            </Card>
        </div>
    );
}
