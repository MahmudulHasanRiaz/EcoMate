'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MonitorSmartphone, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    getDeferredPrompt,
    clearDeferredPrompt,
    listenForBeforeInstallPrompt,
    listenForAppInstalled,
    isStandalone,
    isIOS,
} from '@/lib/pwa-install';

export function PwaInstallCTA({ appName }: { appName: string }) {
    const [installEvent, setInstallEvent] = React.useState<any>(null);
    const [isInstallable, setIsInstallable] = React.useState(false);
    const [isInstalled, setIsInstalled] = React.useState(false);

    React.useEffect(() => {
        if (isStandalone()) {
            setIsInstalled(true);
            return;
        }

        // Check cached prompt
        const cached = getDeferredPrompt();
        if (cached) {
            setInstallEvent(cached);
            setIsInstallable(true);
        }

        const cleanupPrompt = listenForBeforeInstallPrompt((e) => {
            setInstallEvent(e);
            setIsInstallable(true);
        });

        const cleanupInstalled = listenForAppInstalled(() => {
            setIsInstalled(true);
            setIsInstallable(false);
            setInstallEvent(null);
        });

        return () => {
            cleanupPrompt();
            cleanupInstalled();
        };
    }, []);

    const handleInstall = async () => {
        if (!installEvent?.prompt) return;
        try {
            await installEvent.prompt();
            const choice = await installEvent.userChoice;
            if (choice?.outcome === 'accepted') {
                setIsInstalled(true);
            }
            // Prompt is single-use — always clear after use
            clearDeferredPrompt();
            setIsInstallable(false);
            setInstallEvent(null);
        } catch (err) {
            console.error('[PWA_INSTALL_ERROR]', err);
        }
    };

    if (isInstalled) {
        return (
            <div className="rounded-lg border bg-muted/60 p-4 flex items-center gap-3">
                <div className="rounded-full bg-green-100 text-green-700 p-2">
                    <CheckCircle2 className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                    <p className="text-sm font-semibold">{appName} is installed</p>
                    <p className="text-xs text-muted-foreground">Open it from your home screen for faster access.</p>
                </div>
            </div>
        );
    }

    if (!isInstallable && !isIOS()) {
        return null;
    }

    return (
        <div className={cn(
            "rounded-lg border p-4 space-y-3",
            isInstallable ? "bg-primary/5" : "bg-muted/60"
        )}>
            <div className="flex items-center gap-2">
                <div className="rounded-full bg-primary/10 text-primary p-2">
                    <MonitorSmartphone className="h-5 w-5" />
                </div>
                <div className="space-y-0.5">
                    <p className="text-sm font-semibold">Install {appName}</p>
                    <p className="text-xs text-muted-foreground">
                        Add the app to your home screen for faster, full-screen access.
                    </p>
                </div>
                {isInstallable && <Badge className="ml-auto" variant="outline">PWA</Badge>}
            </div>
            {isInstallable ? (
                <Button size="sm" className="w-full" onClick={handleInstall}>
                    Install App
                </Button>
            ) : (
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="h-4 w-4 mt-0.5" />
                    <p>
                        On iOS Safari: tap <strong>Share</strong> → <strong>Add to Home Screen</strong> to install {appName}.
                    </p>
                </div>
            )}
        </div>
    );
}
