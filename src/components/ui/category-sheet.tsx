'use client';

import * as React from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { getCategories } from '@/services/products';
import type { Category } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

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
                        "flex-1 justify-start h-10 text-[15px] font-medium px-3 hover:bg-transparent",
                        isSelected ? "text-primary font-bold" : "text-foreground/80"
                    )}
                    onClick={() => onSelectCategory(category.id)}
                >
                    <span className="truncate">{category.name}</span>
                </Button>

                {hasChildren && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-muted-foreground/60 hover:text-foreground shrink-0"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsExpanded(!isExpanded);
                        }}
                    >
                        <span className="text-xl font-mono leading-none">
                            {isExpanded ? '−' : '+'}
                        </span>
                    </Button>
                )}
            </div>

            {hasChildren && isExpanded && (
                <div className="ml-4 border-l-2 border-muted-foreground/10 pl-2 mt-1.5 flex flex-col gap-1">
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
        <nav className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between px-2 mb-1">
                <h3 className="font-bold text-[11px] uppercase tracking-widest text-muted-foreground/70">Explore Collections</h3>
            </div>

            <Button
                variant={!selectedCategory ? 'secondary' : 'ghost'}
                className={cn(
                    "justify-start h-11 text-base font-semibold px-4 mb-2 transition-all",
                    !selectedCategory ? "shadow-sm border border-primary/10" : "text-foreground/80 hover:bg-muted/50"
                )}
                onClick={() => onSelectCategory(null)}
            >
                All Products
            </Button>

            <div className="flex flex-col gap-1.5">
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

export function CategorySheet() {
    const [open, setOpen] = React.useState(false);
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const [categories, setCategories] = React.useState<Category[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);

    const selectedCategoryId = searchParams.get('category');

     React.useEffect(() => {
        setIsLoading(true);
        getCategories().then(categoryData => {
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
        setOpen(false);
    };

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="mr-2 sm:mr-4">
                    <Menu className="h-6 w-6" />
                    <span className="sr-only">Toggle Menu</span>
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 flex flex-col h-full border-r-0 sm:border-r w-[85vw] sm:w-[400px]">
                <SheetHeader className="p-5 border-b bg-muted/20">
                    <SheetTitle className="text-xl font-bold tracking-tight text-left">Menu</SheetTitle>
                </SheetHeader>
                
                <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col">
                    <div className="p-4 border-b space-y-2 bg-muted/5">
                        <Button
                            variant={pathname?.startsWith('/shop') ? 'secondary' : 'ghost'}
                            className={cn("justify-start w-full h-12 text-base", pathname?.startsWith('/shop') && "shadow-sm font-semibold")}
                            onClick={() => {
                                router.push('/shop');
                                setOpen(false);
                            }}
                        >
                            Shop Home
                        </Button>
                        <Button
                            variant={pathname?.startsWith('/track-order') ? 'secondary' : 'ghost'}
                            className={cn("justify-start w-full h-12 text-base", pathname?.startsWith('/track-order') && "shadow-sm font-semibold")}
                            onClick={() => {
                                router.push('/track-order');
                                setOpen(false);
                            }}
                        >
                            Track Order
                        </Button>
                    </div>
                    
                    {isLoading ? (
                        <div className="space-y-3 p-4">
                            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-md" />)}
                        </div>
                    ) : (
                        <CategoryNav categories={categories} selectedCategory={selectedCategoryId} onSelectCategory={handleSelectCategory} />
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
