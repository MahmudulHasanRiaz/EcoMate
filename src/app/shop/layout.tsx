
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

function CategoryTreeItem({
    category,
    allCategories,
    selectedCategory,
    onSelectCategory,
    level = 0
}: {
    category: Category,
    allCategories: Category[],
    selectedCategory: string | null,
    onSelectCategory: (id: string | null) => void,
    level?: number
}) {
    const children = allCategories.filter(c => c.parentId === category.id);
    const hasChildren = children.length > 0;

    // Auto-expand if the selected category is a descendant
    const isDescendantSelected = React.useMemo(() => {
        if (!selectedCategory) return false;
        const checkChildren = (parentId: string): boolean => {
            const subs = allCategories.filter(c => c.parentId === parentId);
            return subs.some(s => s.id === selectedCategory || checkChildren(s.id));
        };
        return checkChildren(category.id);
    }, [category.id, allCategories, selectedCategory]);

    const [isExpanded, setIsExpanded] = React.useState(isDescendantSelected);

    React.useEffect(() => {
        if (isDescendantSelected) {
            setIsExpanded(true);
        }
    }, [isDescendantSelected]);

    const isSelected = selectedCategory === category.id;

    return (
        <div className="flex flex-col">
            <div className={cn(
                "flex items-center group rounded-md transition-all",
                isSelected ? "bg-secondary text-secondary-foreground" : "hover:bg-muted/50"
            )}>
                <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                        "flex-1 justify-start h-9 text-sm font-medium px-2 hover:bg-transparent",
                        isSelected ? "text-primary font-bold" : "text-foreground/70"
                    )}
                    onClick={() => onSelectCategory(category.id)}
                >
                    <span className="truncate">{category.name}</span>
                </Button>

                {hasChildren && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground/60 hover:text-foreground shrink-0"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsExpanded(!isExpanded);
                        }}
                    >
                        <span className="text-lg font-mono leading-none">
                            {isExpanded ? '−' : '+'}
                        </span>
                    </Button>
                )}
            </div>

            {hasChildren && isExpanded && (
                <div className="ml-3 border-l border-muted-foreground/10 pl-1 mt-1 flex flex-col gap-0.5">
                    {children.map(child => (
                        <CategoryTreeItem
                            key={child.id}
                            category={child}
                            allCategories={allCategories}
                            selectedCategory={selectedCategory}
                            onSelectCategory={onSelectCategory}
                            level={level + 1}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function CategoryNav({ categories, selectedCategory, onSelectCategory }: { categories: Category[], selectedCategory: string | null, onSelectCategory: (id: string | null) => void }) {
    const mainCategories = categories.filter(c => !c.parentId);

    return (
        <nav className="flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between px-2 mb-2">
                <h3 className="font-bold text-sm uppercase tracking-widest text-muted-foreground/80">Categories</h3>
            </div>

            <Button
                variant={!selectedCategory ? 'secondary' : 'ghost'}
                className={cn(
                    "justify-start h-10 text-sm font-semibold px-3 mb-2 transition-all",
                    !selectedCategory ? "shadow-sm" : "text-foreground/70"
                )}
                onClick={() => onSelectCategory(null)}
            >
                All Collections
            </Button>

            <div className="flex flex-col gap-1">
                {mainCategories.map(cat => (
                    <CategoryTreeItem
                        key={cat.id}
                        category={cat}
                        allCategories={categories}
                        selectedCategory={selectedCategory}
                        onSelectCategory={onSelectCategory}
                    />
                ))}
            </div>
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
