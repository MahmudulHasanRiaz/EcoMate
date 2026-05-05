
'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';

import { getShopProducts, getShopCategories } from '@/services/products';
import type { Product, Category } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationPrevious,
    PaginationNext,
} from "@/components/ui/pagination";
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, X } from 'lucide-react';
import { PlaceHolderImages } from '@/lib/placeholder-images';

const ITEMS_PER_PAGE = 12;
const DEFAULT_PLACEHOLDER = PlaceHolderImages[0].imageUrl;

function ProductCard({ product }: { product: Product }) {
    const imageUrl = product.image ?? DEFAULT_PLACEHOLDER;
    const hasSalePrice = product.salePrice && product.salePrice > 0;

    return (
        <Link href={`/shop/products/by-slug/${product.slug}`} className="group block">
            <Card className="overflow-hidden h-full flex flex-col border transition-all duration-300 hover:shadow-lg hover:border-primary">
                <div className="aspect-square overflow-hidden relative">
                    <Image
                        src={imageUrl}
                        alt={product.name}
                        width={400}
                        height={400}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                </div>
                <CardContent className="p-3 sm:p-4 border-t flex flex-col flex-grow">
                    <h3 className="font-semibold text-base leading-snug group-hover:text-primary transition-colors line-clamp-1" title={product.name}>
                        {product.name}
                    </h3>
                    <div className="mt-auto pt-2">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-baseline gap-2">
                                {hasSalePrice ? (
                                    <>
                                        <span className="font-bold text-lg text-primary">৳{product.salePrice!.toLocaleString()}</span>
                                        <span className="text-sm text-muted-foreground line-through opacity-50">৳{product.price.toLocaleString()}</span>
                                    </>
                                ) : (
                                    <span className="font-bold text-lg">৳{product.price.toLocaleString()}</span>
                                )}
                            </div>
                            {product.wholesaleEnabled && product.wholesaleVisible && (
                                <span className="text-[10px] font-bold text-primary/70 bg-primary/5 px-1.5 py-0.5 rounded border border-primary/10">
                                    WS: ৳{product.wholesalePrice?.toLocaleString()}
                                </span>
                            )}
                        </div>

                        {/* Stock & Variants */}
                        <div className="mt-2 space-y-2">
                            <div className="flex items-center gap-1.5">
                                <div className={cn(
                                    "h-1.5 w-1.5 rounded-full",
                                    product.inventory > 0 ? "bg-emerald-500" : "bg-red-500"
                                )} />
                                <span className={cn(
                                    "text-[11px] font-medium tracking-tight uppercase",
                                    product.inventory > 0 ? "text-emerald-600" : "text-red-600"
                                )}>
                                    {product.inventory > 0 ? 'In Stock' : 'Out of Stock'}
                                </span>
                            </div>

                        </div>
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}

function ShopPageContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [products, setProducts] = React.useState<Product[]>([]);
    const [categories, setCategories] = React.useState<Category[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [searchQuery, setSearchQuery] = React.useState("");

    const selectedCategoryId = searchParams.get('category');
    const page = searchParams.get('page') ? parseInt(searchParams.get('page') as string, 10) : 1;

    React.useEffect(() => {
        setIsLoading(true);
        Promise.all([getShopProducts(), getShopCategories()]).then(([productData, categoryData]) => {
            setProducts(productData);
            setCategories(categoryData);
            setIsLoading(false);
        });
    }, []);

    const filteredProducts = React.useMemo(() => {
        let result = products;

        // Category filter
        if (selectedCategoryId) {
            const getDescendantIds = (parentId: string): string[] => {
                const children = categories.filter(c => c.parentId === parentId);
                let ids = children.map(c => c.id);
                for (const child of children) {
                    ids = ids.concat(getDescendantIds(child.id));
                }
                return ids;
            };
            const allTargetCategoryIds = [selectedCategoryId, ...getDescendantIds(selectedCategoryId)];
            result = result.filter(p => p.categoryId && allTargetCategoryIds.includes(p.categoryId));
        }

        // Search filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim();
            result = result.filter(p => 
                p.name.toLowerCase().includes(query) || 
                (p.sku && p.sku.toLowerCase().includes(query))
            );
        }

        return result;
    }, [products, categories, selectedCategoryId, searchQuery]);

    const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
    const paginatedProducts = React.useMemo(() => {
        const startIndex = (page - 1) * ITEMS_PER_PAGE;
        return filteredProducts.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredProducts, page]);

    const handlePageChange = (newPage: number) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('page', newPage.toString());
        router.push(`/shop?${params.toString()}`);
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search products..."
                        className="pl-9 pr-10 rounded-full bg-muted/30 border-muted-foreground/10 focus-visible:ring-primary/20"
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value);
                            const params = new URLSearchParams(searchParams.toString());
                            params.set('page', '1'); // Reset to page 1 on search
                            router.push(`/shop?${params.toString()}`, { scroll: false });
                        }}
                    />
                    {searchQuery && (
                        <button 
                            onClick={() => setSearchQuery("")}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>
                {selectedCategoryId && (
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-xs text-muted-foreground hover:text-primary"
                        onClick={() => {
                            const params = new URLSearchParams(searchParams.toString());
                            params.delete('category');
                            router.push(`/shop?${params.toString()}`);
                        }}
                    >
                        Clear Category Filter
                    </Button>
                )}
            </div>

            {isLoading ? (
                <ShopLoadingSkeleton />
            ) : (
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
                    {paginatedProducts.map(product => (
                        <ProductCard key={product.id} product={product} />
                    ))}
                </div>
            )}
            {!isLoading && filteredProducts.length === 0 && (
                <div className="text-center py-24 border rounded-3xl bg-muted/5">
                    <div className="bg-muted/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Search className="h-8 w-8 text-muted-foreground/40" />
                    </div>
                    <h3 className="font-bold text-lg">No products found</h3>
                    <p className="text-muted-foreground max-w-[250px] mx-auto text-sm mt-1">
                        Try adjusting your search or category filters to find what you're looking for.
                    </p>
                    {(searchQuery || selectedCategoryId) && (
                        <Button 
                            variant="link" 
                            className="mt-4"
                            onClick={() => {
                                setSearchQuery("");
                                const params = new URLSearchParams(searchParams.toString());
                                params.delete('category');
                                router.push(`/shop?${params.toString()}`);
                            }}
                        >
                            Clear all filters
                        </Button>
                    )}
                </div>
            )}

            {totalPages > 1 && (
                <div className="mt-12">
                    <Pagination>
                        <PaginationContent>
                            <PaginationItem>
                                <Button
                                    variant="ghost"
                                    onClick={() => handlePageChange(Math.max(1, page - 1))}
                                    disabled={page === 1}
                                    aria-label="Go to previous page"
                                >
                                    Previous
                                </Button>
                            </PaginationItem>
                            <PaginationItem>
                                <span className="text-sm text-muted-foreground p-2">
                                    Page {page} of {totalPages}
                                </span>
                            </PaginationItem>
                            <PaginationItem>
                                <Button
                                    variant="ghost"
                                    onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
                                    disabled={page === totalPages}
                                    aria-label="Go to next page"
                                >
                                    Next
                                </Button>
                            </PaginationItem>
                        </PaginationContent>
                    </Pagination>
                </div>
            )}
        </div>
    );
}

function ShopLoadingSkeleton() {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
            {[...Array(8)].map((_, i) => (
                <Card key={i}>
                    <Skeleton className="aspect-square w-full" />
                    <CardContent className="p-4 space-y-2">
                        <Skeleton className="h-6 w-3/4" />
                        <Skeleton className="h-6 w-1/3 mt-2" />
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

export default function ShopPage() {
    return (
        <React.Suspense fallback={<ShopLoadingSkeleton />}>
            <ShopPageContent />
        </React.Suspense>
    );
}
