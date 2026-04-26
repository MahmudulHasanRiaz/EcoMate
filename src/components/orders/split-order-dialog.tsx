'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import type { Order, OrderProduct } from '@/types';

interface SplitOrderDialogProps {
    order: Order;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
}

export function SplitOrderDialog({ order, open, onOpenChange, onSuccess }: SplitOrderDialogProps) {
    const { toast } = useToast();
    const router = useRouter();
    const [isSubmitting, setIsSubmitting] = React.useState(false);

    // State to track selected items and their return quantities
    // Map<"productId-variantId", quantity>
    const [selectedItems, setSelectedItems] = React.useState<Map<string, number>>(new Map());
    const [discountAdjustment, setDiscountAdjustment] = React.useState('');

    // Reset when opening
    React.useEffect(() => {
        if (open) {
            setSelectedItems(new Map());
            setDiscountAdjustment('');
        }
    }, [open]);

    const toggleItem = (itemKey: string, maxQty: number) => {
        const next = new Map(selectedItems);
        if (next.has(itemKey)) {
            next.delete(itemKey);
        } else {
            next.set(itemKey, maxQty); // Default to full quantity
        }
        setSelectedItems(next);
    };

    const updateQuantity = (itemKey: string, qty: number, max: number) => {
        const next = new Map(selectedItems);
        if (qty > 0) {
            next.set(itemKey, Math.min(qty, max));
        } else {
            next.delete(itemKey);
        }
        setSelectedItems(next);
    };

    const handleSubmit = async () => {
        if (selectedItems.size === 0) {
            toast({ variant: 'destructive', title: 'Start selection', description: 'Please select at least one item to return.' });
            return;
        }

        setIsSubmitting(true);
        try {
            const returnedItems = Array.from(selectedItems.entries()).map(([itemKey, quantity]) => {
                const [productId, variantId] = itemKey.split('-');
                return {
                    productId,
                    variantId: variantId !== 'null' ? variantId : null,
                    quantity,
                };
            });

            const res = await fetch('/api/orders/split', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId: order.id,
                    returnedItems,
                    keptItems: [], // Required by backend validation
                    user: 'Staff',
                    discountAdjustment: Number(discountAdjustment) || 0,
                }),
            });

            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.message || 'Failed to split order');
            }
            const data = payload?.data || payload;

            toast({
                title: 'Order Split Successful',
                description: `Created Return Order ${data.childOrder.id}.`,
            });

            onOpenChange(false);
            if (onSuccess) onSuccess();
            router.refresh();

        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Split Failed',
                description: error.message,
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    // Calculate totals for preview
    const selectedCount = Array.from(selectedItems.values()).reduce((a, b) => a + b, 0);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-w-[600px] gap-6">
                <DialogHeader>
                    <DialogTitle>Partial Return (Split Order)</DialogTitle>
                    <DialogDescription>
                        Select only the items that are being <strong>RETURNED</strong>.
                        The kept items will remain in this order (marked Delivered).
                        The returned items will move to a new order (Status: Return Pending).
                    </DialogDescription>
                </DialogHeader>

                <div className="py-2 max-h-[50vh] overflow-y-auto border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-10">Select</TableHead>
                                <TableHead>Product</TableHead>
                                <TableHead className="w-20 text-right">Qty</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {order.products.map((product) => {
                                const itemKey = `${product.productId}-${product.variantId || 'null'}`;
                                const isSelected = selectedItems.has(itemKey);
                                const returnQty = selectedItems.get(itemKey) || 0;

                                return (
                                    <TableRow key={itemKey} className={isSelected ? 'bg-muted/50' : ''}>
                                        <TableCell className="py-2">
                                            <Checkbox
                                                checked={isSelected}
                                                onCheckedChange={() => toggleItem(itemKey, product.quantity)}
                                            />
                                        </TableCell>
                                        <TableCell className="py-2">
                                            <div className="flex flex-col gap-1">
                                                <span className="font-medium text-sm line-clamp-2">{product.name}</span>
                                                <div className="flex flex-wrap gap-1">
                                                    {product.variantAttributes && Object.keys(product.variantAttributes).length > 0 ? (
                                                        Object.entries(product.variantAttributes).map(([key, val]) => (
                                                            <Badge key={key} variant="outline" className="text-[10px] h-5">
                                                                {key}: {val}
                                                            </Badge>
                                                        ))
                                                    ) : null}
                                                </div>
                                                <span className="text-xs text-muted-foreground">Original: {product.quantity}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right py-2">
                                            <Input
                                                type="number"
                                                className="h-8 w-16 text-right ml-auto px-2"
                                                value={isSelected ? returnQty : ''}
                                                disabled={!isSelected}
                                                min={1}
                                                max={product.quantity}
                                                onChange={(e) => updateQuantity(itemKey, parseInt(e.target.value) || 0, product.quantity)}
                                            />
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>

                <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-4 items-end sm:items-center">
                    <Label className="whitespace-nowrap">Decrease Parent Discount By:</Label>
                    <Input
                        type="number"
                        className="h-9 w-full sm:w-24 text-right"
                        value={discountAdjustment}
                        onChange={(e) => setDiscountAdjustment(e.target.value)}
                        min={0}
                        max={order.discount || 0}
                        placeholder="0"
                    />
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:justify-between items-center gap-4 mt-2">
                    <div className="text-sm text-muted-foreground">
                        Returning {selectedCount} items
                    </div>
                    <div className="flex gap-2 w-full sm:w-auto">
                        <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={isSubmitting || selectedCount === 0}
                            className="flex-1 sm:flex-none bg-purple-600 hover:bg-purple-700 text-white"
                        >
                            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                            Create Return Order
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog >
    );
}
