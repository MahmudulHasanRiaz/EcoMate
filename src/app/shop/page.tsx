
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
        if (!selectedCategoryId) {
            return products;
        }
        let currentCategory = categories.find(c => c.id === selectedCategoryId);
        if (currentCategory && !currentCategory.parentId) {
            const childCategoryIds = categories.filter(c => c.parentId === selectedCategoryId).map(c => c.id);
            const allIds = [selectedCategoryId, ...childCategoryIds];
            return products.filter(p => p.categoryId && allIds.includes(p.categoryId));
        }
        return products.filter(p => p.categoryId === selectedCategoryId);
    }, [products, categories, selectedCategoryId]);

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
        <>
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
                <div className="text-center text-muted-foreground py-16">
                    <p>No products found in this category.</p>
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
        </>
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
