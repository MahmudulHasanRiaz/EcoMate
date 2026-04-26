
'use client';

import * as React from 'react';
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { CategorySheet } from "@/components/ui/category-sheet";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { getShopCategories } from '@/services/products';
import type { Category } from '@/types';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

function CategoryNav({ categories, selectedCategory, onSelectCategory }: { categories: Category[], selectedCategory: string | null, onSelectCategory: (id: string | null) => void }) {
    const mainCategories = categories.filter(c => !c.parentId);
    const subCategories = (parentId: string) => categories.filter(c => c.parentId === parentId);

    const getParentId = (childId: string | null): string | null => {
        if (!childId) return null;
        const category = categories.find(c => c.id === childId);
        return category?.parentId || null;
    };

    const parentOfSelected = getParentId(selectedCategory);

    return (
        <nav className="flex flex-col gap-1 p-4">
            <h3 className="font-semibold text-lg px-3 mb-2">Categories</h3>
            <Button
                variant={!selectedCategory ? 'secondary' : 'ghost'}
                className="justify-start text-base"
                onClick={() => onSelectCategory(null)}
            >
                All Products
            </Button>
            <Accordion type="single" collapsible defaultValue={parentOfSelected || undefined} className="w-full">
                {mainCategories.map(cat => {
                    const children = subCategories(cat.id);
                    const isParentSelected = selectedCategory === cat.id && children.length > 0;

                    if (children.length === 0) {
                        return (
                            <Button
                                key={cat.id}
                                variant={selectedCategory === cat.id ? 'secondary' : 'ghost'}
                                className="justify-start w-full text-base"
                                onClick={() => onSelectCategory(cat.id)}
                            >
                                {cat.name}
                            </Button>
                        )
                    }
                    return (
                        <AccordionItem value={cat.id} key={cat.id} className="border-b-0">
                            <AccordionTrigger
                                className={cn(
                                    "py-2 px-3 text-base font-medium hover:no-underline rounded-md hover:bg-muted",
                                    isParentSelected && !children.some(c => c.id === selectedCategory) && 'bg-secondary'
                                )}
                            >
                                {cat.name}
                            </AccordionTrigger>
                            <AccordionContent className="pt-1 pl-4">
                                <div className="flex flex-col gap-1">
                                    {children.map(subCat => (
                                        <Button
                                            key={subCat.id}
                                            variant={selectedCategory === subCat.id ? 'secondary' : 'ghost'}
                                            className="justify-start w-full text-muted-foreground hover:text-foreground h-9"
                                            onClick={() => onSelectCategory(subCat.id)}
                                        >
                                            {subCat.name}
                                        </Button>
                                    ))}
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    )
                })}
            </Accordion>
        </nav>
    );
}


function DesktopSidebar() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [categories, setCategories] = React.useState<Category[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);

    const selectedCategoryId = searchParams.get('category');

    React.useEffect(() => {
        setIsLoading(true);
        getShopCategories().then(categoryData => {
            setCategories(categoryData);
            setIsLoading(false);
        });
    }, []);

    const handleSelectCategory = (categoryId: string | null) => {
        const params = new URLSearchParams(searchParams.toString());
        if (categoryId) {
            params.set('category', categoryId);
        } else {
            params.delete('category');
        }
        router.push(`/shop?${params.toString()}`);
    };

    return (
        <aside className="hidden lg:block lg:col-span-1">
            <div className="sticky top-24">
                {isLoading ? (
                    <div className="space-y-2 p-4">
                        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                    </div>
                ) : (
                    <CategoryNav categories={categories} selectedCategory={selectedCategoryId} onSelectCategory={handleSelectCategory} />
                )}
            </div>
        </aside>
    );
}

export default function ShopLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const isShopPage = pathname?.startsWith('/shop');
    const isTrackPage = pathname?.startsWith('/track-order');

    return (
        <div className="flex flex-col min-h-screen bg-muted/50">
            <div className="container max-w-7xl mx-auto px-4 sm:px-8 bg-background">
                <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-sm">
                    <div className="flex h-16 items-center justify-between">
                        <div className="lg:hidden flex items-center gap-2">
                            <React.Suspense fallback={<Button variant="ghost" size="icon" className="mr-2 sm:mr-4"><Skeleton className="h-6 w-6" /></Button>}>
                                <CategorySheet />
                            </React.Suspense>
                        </div>

                        <div className="flex flex-1 items-center justify-center lg:justify-start">
                            <Link href="/" className="flex items-center gap-2">
                                <Logo variant="full" />
                            </Link>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="hidden sm:flex items-center gap-1">
                                <Button asChild size="sm" variant={isShopPage ? 'secondary' : 'ghost'}>
                                    <Link href="/shop">Shop</Link>
                                </Button>
                                <Button asChild size="sm" variant={isTrackPage ? 'secondary' : 'ghost'}>
                                    <Link href="/track-order">Track Order</Link>
                                </Button>
                            </div>
                            <CopyLinkButton />
                        </div>
                    </div>
                </header>
                <main className="flex-1">
                    <div className="py-8">
                        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                            <React.Suspense fallback={<div className="hidden lg:block lg:col-span-1"><div className="space-y-2 p-4">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div></div>}>
                                <DesktopSidebar />
                            </React.Suspense>
                            <main className="lg:col-span-4">
                                {children}
                            </main>
                        </div>
                    </div>
                </main>
                <footer className="py-6 md:px-8 md:py-0 border-t">
                    <div className="flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row">
                        <p className="text-balance text-center text-[11px] sm:text-xs leading-loose text-muted-foreground/60 md:text-left font-medium tracking-tight">
                            Built with <a href="https://ecomate.bd" target="_blank" rel="noopener noreferrer" className="text-primary/70 hover:text-primary transition-all duration-300 hover:tracking-widest cursor-pointer decoration-primary/30 underline-offset-4 hover:underline">EcoMate</a>.
                        </p>
                    </div>
                </footer>
            </div>
        </div>
    );
}
