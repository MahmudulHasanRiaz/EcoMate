'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, MonitorSmartphone, Share } from 'lucide-react';
import {
  getDeferredPrompt,
  clearDeferredPrompt,
  listenForBeforeInstallPrompt,
  listenForAppInstalled,
  isStandalone as checkStandalone,
  isIOS as checkIsIOS,
} from '@/lib/pwa-install';

export default function InstallPage() {
  const [installEvent, setInstallEvent] = React.useState<any>(null);
  const [isInstallable, setIsInstallable] = React.useState(false);
  const [isInstalled, setIsInstalled] = React.useState(false);
  const [isIOSDevice, setIsIOSDevice] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Check if already installed
    if (checkStandalone()) {
      setIsInstalled(true);
      return;
    }

    setIsIOSDevice(checkIsIOS());

    // Check for cached prompt (fired on a previous page)
    const cached = getDeferredPrompt();
    if (cached) {
      setInstallEvent(cached);
      setIsInstallable(true);
    }

    // Listen for new prompt (in case it fires on this page)
    const cleanupPrompt = listenForBeforeInstallPrompt((e) => {
      setInstallEvent(e);
      setIsInstallable(true);
    });

    // Listen for install completed
    const cleanupInstalled = listenForAppInstalled(() => {
      setIsInstalled(true);
      setIsInstallable(false);
      setInstallEvent(null);
      setStatus(null);
    });

    return () => {
      cleanupPrompt();
      cleanupInstalled();
    };
  }, []);

  const handleInstall = async () => {
    if (!installEvent?.prompt) {
      setStatus('Install prompt not available. Use your browser menu to install.');
      return;
    }
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice?.outcome === 'accepted') {
        setStatus('Install request sent. Follow the browser prompt.');
        setIsInstalled(true);
      } else {
        setStatus('Install was cancelled.');
      }
      // Prompt is single-use — always clear after use
      clearDeferredPrompt();
      setIsInstallable(false);
      setInstallEvent(null);
    } catch (err) {
      console.error('[PWA_INSTALL_ERROR]', err);
      setStatus('Install failed. Please try again.');
    }
  };

  // Already installed — success state
  if (isInstalled) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6">
        <Card className="w-full max-w-md shadow-sm border-green-200">
          <CardContent className="p-6 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-700">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-xl font-bold">App Installed</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Open the app from your home screen for the best experience.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-sm border-primary/10">
        <CardContent className="p-6 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MonitorSmartphone className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Install App</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isInstallable
                ? 'Click the button to install the app on this device.'
                : isIOSDevice
                  ? 'Follow the steps below to install on your iPhone/iPad.'
                  : 'The install prompt will appear when ready. You can also use your browser menu.'}
            </p>
          </div>

          {/* Installable: standard prompt button */}
          {isInstallable && (
            <Button onClick={handleInstall} className="w-full">
              Install
            </Button>
          )}

          {/* iOS: manual install instructions */}
          {!isInstallable && isIOSDevice && (
            <div className="rounded-lg border bg-muted/60 p-4 text-left space-y-3">
              <p className="text-sm font-semibold">How to install on iOS:</p>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li className="flex items-start gap-2">
                  <Share className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
                  <span>Tap the <strong>Share</strong> button at the bottom of Safari</span>
                </li>
                <li>Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong></li>
                <li>Tap <strong>&quot;Add&quot;</strong> to confirm</li>
              </ol>
            </div>
          )}

          {/* Non-iOS, not installable: waiting state */}
          {!isInstallable && !isIOSDevice && (
            <Button disabled className="w-full">
              Waiting for install prompt...
            </Button>
          )}

          {status && (
            <p className="text-xs text-muted-foreground">{status}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
