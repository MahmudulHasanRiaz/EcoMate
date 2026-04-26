'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from '@/components/ui/dialog';
import { PlusCircle, Search, Check, Loader2 } from 'lucide-react';
import Image from 'next/image';
import type { Product, ProductVariant } from '@/types';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getVariantLabel } from '@/lib/variant-label';

const fetchApi = async <T,>(url: string): Promise<T> => {
    const res = await fetch(url);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json?.message || `API error: ${res.status}`);
    }
    // Support both raw JSON and apiSuccess({ success, data })
    if (json && typeof json === 'object' && 'success' in json) {
        if (!(json as any).success) throw new Error((json as any).message || 'API error');
        return (json as any).data as T;
    }
    return json as T;
};

interface PurchaseProductAddDialogProps {
    allProducts: Product[];
    onAdd: (product: Product, variantId?: string | null) => void;
    existingSelections: { productId: string; variantId?: string | null }[];
}

type StockAggregateMap = Record<string, { quantity: number; reserved: number; available: number }>;

export function PurchaseProductAddDialog({ allProducts, onAdd, existingSelections }: PurchaseProductAddDialogProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [searchedProducts, setSearchedProducts] = useState<Product[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    
    const [stockMap, setStockMap] = useState<StockAggregateMap>({});
    const [isLoadingStock, setIsLoadingStock] = useState(false);

    // Debounce search term
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchTerm);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    // Async Server Search
    useEffect(() => {
        if (!isOpen) return;
        const query = debouncedSearch.trim();
        if (!query) {
            setSearchedProducts([]);
            return;
        }

        let isActive = true;
        setIsSearching(true);
        fetchApi<{ items?: Product[] } | Product[]>(`/api/products?search=${encodeURIComponent(query)}&pageSize=50&mode=lookup`)
            .then(res => {
                if (!isActive) return;
                const products = Array.isArray(res) ? res : (res.items || []);
                setSearchedProducts(products);
            })
            .catch(err => {
                console.error("Async product search failed:", err);
            })
            .finally(() => {
                if (isActive) setIsSearching(false);
            });
        
        return () => { isActive = false; };
    }, [debouncedSearch, isOpen]);

    // Fetch real inventory aggregates when dialog opens
    useEffect(() => {
        if (!isOpen) return;
        setIsLoadingStock(true);
        fetchApi<{ items: Array<{ productId: string; variantId?: string | null; quantity: number; reservedQuantity: number }> }>('/api/inventory/stock-aggregates')
            .then((res) => {
                const map: StockAggregateMap = {};
                for (const row of (res.items || [])) {
                    const key = `${row.productId}:${row.variantId ?? ''}`;
                    if (!map[key]) {
                        map[key] = { quantity: 0, reserved: 0, available: 0 };
                    }
                    map[key].quantity += row.quantity;
                    map[key].reserved += row.reservedQuantity;
                    map[key].available += Math.max(row.quantity - row.reservedQuantity, 0);
                }
                setStockMap(map);
            })
            .catch((err) => {
                console.error('Failed to load stock aggregates', err);
            })
            .finally(() => setIsLoadingStock(false));
    }, [isOpen]);

    const getAggregateStock = (productId: string, variantId?: string | null) => {
        const key = `${productId}:${variantId ?? ''}`;
        return stockMap[key]?.available ?? 0;
    };

    const displayProducts = debouncedSearch.trim()
        ? searchedProducts
        : allProducts.filter(p =>
            p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            p.sku?.toLowerCase().includes(searchTerm.toLowerCase())
        );

    const isSelected = (productId: string, variantId?: string | null) => {
        return existingSelections.some(
            item => item.productId === productId && (item.variantId ?? null) === (variantId ?? null)
        );
    };

    const handleAdd = (product: Product, variantId?: string | null) => {
        onAdd(product, variantId);
        // We keep dialog open to allow adding multiple items
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                    <PlusCircle className="h-4 w-4" />
                    Add Products
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-3xl h-[80vh] flex flex-col p-0 gap-0">
                <DialogHeader className="px-6 py-4 border-b">
                    <DialogTitle>Add Products to Purchase Order</DialogTitle>
                    <DialogDescription>
                        Search and select products to add. You can add multiple items.
                    </DialogDescription>
                    <div className="relative mt-2">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by name or SKU..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                </DialogHeader>

                <ScrollArea className="flex-1 p-6">
                    {isLoadingStock && (
                        <div className="flex items-center justify-center py-2 text-xs text-muted-foreground">
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Loading stock data...
                        </div>
                    )}
                    <div className="grid grid-cols-1 gap-4">
                        {isSearching ? (
                            <div className="text-center py-10 text-muted-foreground flex flex-col items-center gap-2">
                                <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                                <span>Searching products...</span>
                            </div>
                        ) : displayProducts.length === 0 ? (
                            <div className="text-center py-10 text-muted-foreground">
                                No products found matching &quot;{searchTerm}&quot;
                            </div>
                        ) : (
                            displayProducts.map((p) => (
                                <div key={p.id} className="flex flex-col sm:flex-row gap-4 border rounded-lg p-4 bg-card hover:bg-muted/30 transition-colors">
                                    <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-md border bg-muted">
                                        {p.image ? (
                                            <Image
                                                src={p.image}
                                                alt={p.name}
                                                fill
                                                className="object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                                                No Img
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex-1 space-y-2">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <div className="font-semibold text-base">{p.name}</div>
                                                <div className="text-sm text-muted-foreground flex gap-2 items-center">
                                                    <span>{p.sku || 'No SKU'}</span>
                                                    <Badge variant="secondary" className="text-[10px] h-5">{p.productType}</Badge>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="pt-2">
                                            {p.productType === 'variable' && p.variants && p.variants.length > 0 ? (
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-medium text-muted-foreground">Available Variants:</Label>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                        {p.variants.map((variant) => {
                                                            const added = isSelected(p.id, variant.id);
                                                            const stockQty = getAggregateStock(p.id, variant.id);
                                                            return (
                                                                <div key={variant.id} className="flex items-center justify-between gap-2 border rounded p-2 text-sm">
                                                                    <div className="flex flex-col">
                                                                        <span className="font-medium">{getVariantLabel(variant, p.name)}</span>
                                                                        <span className="text-xs text-muted-foreground">
                                                                            Available Stock: {stockQty}
                                                                        </span>
                                                                    </div>
                                                                    <Button
                                                                        size="sm"
                                                                        variant={added ? "secondary" : "default"}
                                                                        className={added ? "gap-1 text-green-600" : "gap-1"}
                                                                        onClick={() => !added && handleAdd(p, variant.id)}
                                                                        disabled={added}
                                                                    >
                                                                        {added ? <><Check className="h-3 w-3" /> Added</> : <PlusCircle className="h-3 w-3" />}
                                                                    </Button>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex items-center justify-between mt-2">
                                                    <div className="text-sm text-muted-foreground">
                                                        Available Stock: {getAggregateStock(p.id)}
                                                    </div>
                                                    <Button
                                                        size="sm"
                                                        variant={isSelected(p.id) ? "secondary" : "default"}
                                                        className={isSelected(p.id) ? "gap-1 text-green-600" : "gap-1"}
                                                        onClick={() => !isSelected(p.id) && handleAdd(p, null)}
                                                        disabled={isSelected(p.id)}
                                                    >
                                                        {isSelected(p.id) ? <><Check className="h-3 w-3" /> Added</> : <><PlusCircle className="h-3 w-3" /> Add Item</>}
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>
                <DialogFooter className="border-t p-4">
                    <Button variant="outline" onClick={() => setIsOpen(false)}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
