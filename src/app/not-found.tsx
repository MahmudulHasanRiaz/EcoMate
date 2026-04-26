
'use client';

import Link from 'next/link';
import { Ghost, Home, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
    return (
        <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 sm:px-6 py-12 text-center select-none">
            {/* Cute Floating Ghost */}
            <div className="relative mb-8">
                <div className="animate-bounce duration-[3000ms] transition-all">
                    <Ghost className="h-24 w-24 sm:h-32 sm:w-32 text-primary/20" strokeWidth={1.5} />
                </div>
                {/* Glow behind ghost */}
                <div className="absolute inset-0 bg-primary/5 blur-3xl rounded-full -z-10" />
            </div>

            {/* Error Message */}
            <div className="space-y-4 max-w-md mx-auto">
                <h1 className="text-6xl sm:text-8xl font-black text-primary/10 tracking-tighter">
                    404
                </h1>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                    Lost in Space?
                </h2>
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed italic">
                    The page you're looking for has drifted off into the digital void. Don't worry, it happens to the best of us!
                </p>
            </div>

            {/* Navigation Options */}
            <div className="flex flex-col sm:flex-row gap-3 mt-10">
                <Button asChild variant="default" className="rounded-2xl px-8 h-12 font-bold shadow-lg shadow-primary/10 hover:shadow-xl transition-all hover:scale-105 active:scale-95">
                    <Link href="/">
                        <Home className="mr-2 h-4 w-4" />
                        Go Home
                    </Link>
                </Button>
                <Button
                    variant="outline"
                    onClick={() => window.history.back()}
                    className="rounded-2xl px-8 h-12 font-bold border-muted-foreground/10 hover:bg-muted/50 transition-all active:scale-95"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Go Back
                </Button>
            </div>

            {/* Branding Footer */}
            <div className="mt-16 text-[10px] uppercase tracking-widest text-muted-foreground/40 font-black">
                EcoMate Experience
            </div>
        </div>
    );
}
