'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, PlusCircle, X } from 'lucide-react';
import Image from 'next/image';
import type { Product, ProductVariant } from '@/types';
import { getVariantLabel } from '@/lib/variant-label';

export interface ComboItem {
    childId: string;
    variantId?: string | null;
}

interface ComboProductSelectorProps {
    allProducts: Product[];
    value: ComboItem[];
    onChange: (items: ComboItem[]) => void;
}

/**
 * Validates that all combo items have a variant selected when the child product is variable.
 * Returns an array of error messages. Empty array = valid.
 */
export function validateComboItems(
    items: ComboItem[],
    allProducts: Product[],
): string[] {
    const errors: string[] = [];
    for (const item of items) {
        const product = allProducts.find(p => p.id === item.childId);
        if (!product) continue;
        if (product.productType === 'variable' && !item.variantId) {
            errors.push(`"${product.name}" is a variable product — you must select a variant.`);
        }
    }
    return errors;
}

export function ComboProductSelector({ allProducts, value, onChange }: ComboProductSelectorProps) {
    const [isOpen, setIsOpen] = React.useState(false);
    const [searchTerm, setSearchTerm] = React.useState('');

    const filteredProducts = React.useMemo(() => {
        const needle = searchTerm.trim().toLowerCase();
        if (!needle) return allProducts;

        return allProducts.filter((product) => {
            const nameMatch = product.name.toLowerCase().includes(needle);
            const skuMatch = String(product.sku || '').toLowerCase().includes(needle);
            const variantSkuMatch = (product.variants || []).some((variant) =>
                String(variant.sku || '').toLowerCase().includes(needle)
            );
            return nameMatch || skuMatch || variantSkuMatch;
        });
    }, [allProducts, searchTerm]);

    const addProduct = (productId: string, productType: string) => {
        // For simple/combo products, add directly
        if (productType === 'simple' || productType === 'combo') {
            const newItems = [...value, { childId: productId, variantId: null }];
            onChange(newItems);
        }
        // For variable products, do nothing here - user must select variant
    };

    const selectVariant = (productId: string, variantId: string) => {
        // Check if this product already has an entry
        const existingIndex = value.findIndex(item => item.childId === productId);
        if (existingIndex >= 0) {
            // Update existing entry with new variantId
            const newItems = [...value];
            newItems[existingIndex] = { childId: productId, variantId };
            onChange(newItems);
        } else {
            // Add new entry with variantId
            const newItems = [...value, { childId: productId, variantId }];
            onChange(newItems);
        }
    };

    const removeProduct = (productId: string, variantId?: string | null) => {
        const newItems = value.filter(
            item => !(item.childId === productId && item.variantId === variantId)
        );
        onChange(newItems);
    };

    const isProductSelected = (productId: string) => {
        return value.some(item => item.childId === productId);
    };

    // Check for validation errors
    const validationErrors = React.useMemo(
        () => validateComboItems(value, allProducts),
        [value, allProducts]
    );

    return (
        <Card>
            <CardHeader>
                <CardTitle>Combo Products</CardTitle>
                <CardDescription>
                    Select products and variants to include in this combo.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <Dialog open={isOpen} onOpenChange={setIsOpen}>
                    <DialogTrigger asChild>
                        <Button type="button" variant="outline">
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Add Product...
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>Add Product to Combo</DialogTitle>
                            <DialogDescription>
                                Search and select a product. For variable products, you must select a variant.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="p-4">
                            <Input
                                placeholder="Search for products..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="max-h-[50vh] overflow-y-auto px-4">
                            {filteredProducts.map((p) => {
                                const isAdded = isProductSelected(p.id);
                                const selectedItem = value.find(item => item.childId === p.id);

                                return (
                                    <div key={p.id} className="flex items-start gap-4 py-3 border-b">
                                        <Image
                                            src={p.image ?? ''}
                                            alt={p.name}
                                            width={50}
                                            height={50}
                                            className="rounded-md object-cover"
                                        />
                                        <div className="flex-1 space-y-2">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">{p.name}</span>
                                                <span className="text-xs px-2 py-0.5 bg-muted rounded">
                                                    {p.productType}
                                                </span>
                                            </div>
                                            <span className="text-sm text-muted-foreground">
                                                ৳{p.price.toFixed(2)}
                                            </span>

                                            {/* Variable product: show variant selector — this is the ONLY way to add */}
                                            {p.productType === 'variable' && p.variants && p.variants.length > 0 && (
                                                <div className="pt-2">
                                                    <Label className="text-xs font-semibold text-amber-600">
                                                        Select Variant (required):
                                                    </Label>
                                                    <Select
                                                        onValueChange={(variantId) => selectVariant(p.id, variantId)}
                                                        value={selectedItem?.variantId || ''}
                                                    >
                                                        <SelectTrigger className="w-full mt-1">
                                                            <SelectValue placeholder="Choose a variant" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {p.variants.map((variant: ProductVariant) => (
                                                                <SelectItem key={variant.id} value={variant.id}>
                                                                    {getVariantLabel(variant, p.name)} - ৳
                                                                    {((variant.salePrice || variant.price) ?? 0).toFixed(2)}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    {isAdded && selectedItem?.variantId && (
                                                        <p className="text-xs text-green-600 mt-1">✓ Variant selected & added</p>
                                                    )}
                                                </div>
                                            )}

                                            {/* Variable product with no variants loaded */}
                                            {p.productType === 'variable' && (!p.variants || p.variants.length === 0) && (
                                                <p className="text-xs text-destructive mt-1">
                                                    This variable product has no variants. Cannot add to combo.
                                                </p>
                                            )}

                                            {/* Simple/Combo product: show add/remove button */}
                                            {(p.productType === 'simple' || p.productType === 'combo') && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant={isAdded ? 'destructive' : 'default'}
                                                    onClick={() => {
                                                        if (isAdded) {
                                                            removeProduct(p.id, null);
                                                        } else {
                                                            addProduct(p.id, p.productType);
                                                        }
                                                    }}
                                                    className="mt-2"
                                                >
                                                    {isAdded ? 'Remove' : 'Add to Combo'}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <DialogFooter>
                            <Button type="button" onClick={() => setIsOpen(false)}>
                                Done
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Validation errors */}
                {validationErrors.length > 0 && (
                    <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 space-y-1">
                        {validationErrors.map((err, i) => (
                            <p key={i} className="text-sm text-destructive flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 shrink-0" />
                                {err}
                            </p>
                        ))}
                    </div>
                )}

                <div className="space-y-2 pt-4">
                    <h4 className="font-medium">Selected Products ({value.length}):</h4>
                    {value.length > 0 ? (
                        <div className="space-y-2">
                            {value.map((item) => {
                                const product = allProducts.find(p => p.id === item.childId);
                                if (!product) return null;

                                const variant = item.variantId
                                    ? product.variants?.find((v: ProductVariant) => v.id === item.variantId)
                                    : null;

                                const isMissingVariant = product.productType === 'variable' && !item.variantId;

                                return (
                                    <div
                                        key={`${item.childId}-${item.variantId || 'no-variant'}`}
                                        className={`flex items-center justify-between p-3 border rounded-md ${isMissingVariant ? 'bg-destructive/10 border-destructive/50' : 'bg-muted/50'}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <Image
                                                src={product.image ?? ''}
                                                alt={product.name}
                                                width={40}
                                                height={40}
                                                className="rounded object-cover"
                                            />
                                            <div>
                                                <div className="font-medium text-sm">{product.name}</div>
                                                {variant && (
                                                    <div className="text-xs text-muted-foreground">
                                                        Variant: {getVariantLabel(variant, product.name)}
                                                    </div>
                                                )}
                                                {isMissingVariant && (
                                                    <div className="text-xs text-destructive font-medium flex items-center gap-1">
                                                        <AlertTriangle className="h-3 w-3" />
                                                        Variant required — select one above
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            onClick={() => removeProduct(item.childId, item.variantId)}
                                        >
                                            <X className="h-4 w-4 text-destructive" />
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">No products selected.</p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
