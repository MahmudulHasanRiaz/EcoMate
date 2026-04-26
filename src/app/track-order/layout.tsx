
'use client';

import * as React from 'react';
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { CategorySheet } from "@/components/ui/category-sheet";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { Skeleton } from "@/components/ui/skeleton";

export default function TrackOrderLayout({
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
                            <Link href="/shop" className="flex items-center gap-2">
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

                <main className="flex-1">{children}</main>

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
