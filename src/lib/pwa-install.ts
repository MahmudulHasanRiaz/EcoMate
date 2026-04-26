/**
 * Shared PWA install helper — caches the deferred prompt globally so any page can use it.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

let _deferredPrompt: BeforeInstallPromptEvent | null = null;

export function setDeferredPrompt(e: BeforeInstallPromptEvent) {
  _deferredPrompt = e;
}

export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  // Check module-level cache first
  if (_deferredPrompt) return _deferredPrompt;
  // Fallback: check the early-capture from the inline <head> script
  if (typeof window !== 'undefined' && (window as any).__pwaInstallPrompt) {
    _deferredPrompt = (window as any).__pwaInstallPrompt as BeforeInstallPromptEvent;
    return _deferredPrompt;
  }
  return null;
}

export function clearDeferredPrompt() {
  _deferredPrompt = null;
  if (typeof window !== 'undefined') {
    (window as any).__pwaInstallPrompt = null;
  }
}

/**
 * Listen for the `beforeinstallprompt` event.
 * Caches the event globally and calls `onReady` when available.
 * Returns a cleanup function.
 */
export function listenForBeforeInstallPrompt(
  onReady: (e: BeforeInstallPromptEvent) => void
): () => void {
  // If already cached (fired on a previous page), notify immediately
  if (_deferredPrompt) {
    onReady(_deferredPrompt);
  }

  const handler = (e: Event) => {
    e.preventDefault();
    const prompt = e as BeforeInstallPromptEvent;
    setDeferredPrompt(prompt);
    onReady(prompt);
  };

  window.addEventListener('beforeinstallprompt', handler);
  return () => window.removeEventListener('beforeinstallprompt', handler);
}

/**
 * Listen for the `appinstalled` event.
 * Returns a cleanup function.
 */
export function listenForAppInstalled(onInstalled: () => void): () => void {
  const handler = () => {
    clearDeferredPrompt();
    onInstalled();
  };
  window.addEventListener('appinstalled', handler);
  return () => window.removeEventListener('appinstalled', handler);
}

/** True if the app is already running in standalone/installed mode. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}

/** True if the device is iOS (iPhone/iPad/iPod). */
export function isIOS(): boolean {
  if (typeof window === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}
