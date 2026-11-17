import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useAuth } from '../auth';
import { readJson } from './api';

export type PublicBranding = {
  platformName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
};

export const DEFAULT_BRANDING: PublicBranding = {
  platformName: 'EcoMate',
  logoUrl: null,
  faviconUrl: null,
};

const BrandingContext = createContext<
  PublicBranding & { refresh: () => Promise<void> }
>({ ...DEFAULT_BRANDING, refresh: async () => undefined });

/**
 * Live platform branding (F10/F11). Fetched once from the PUBLIC
 * endpoint (no session needed — the login page needs it too) and applied
 * to the document title + favicon. The sidebar/login render the logo
 * from the same context. A failed fetch keeps the defaults — branding
 * must never break the console.
 *
 * Must render INSIDE AuthProvider (it uses the shared api() caller).
 */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const { api } = useAuth();
  const [branding, setBranding] = useState<PublicBranding>(DEFAULT_BRANDING);

  const refresh = useCallback(async () => {
    try {
      const next = await api('/public/branding').then((response) =>
        readJson<PublicBranding>(response),
      );
      setBranding({
        platformName: next.platformName || DEFAULT_BRANDING.platformName,
        logoUrl: next.logoUrl ?? null,
        faviconUrl: next.faviconUrl ?? null,
      });
    } catch {
      // Keep the previous branding (or the defaults) — a branding fetch
      // failure is not a console failure.
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    document.title = `${branding.platformName} SaaS`;
    const href = branding.faviconUrl ?? branding.logoUrl;
    if (!href) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    if (link.href !== href) link.href = href;
  }, [branding]);

  const value = useMemo(
    () => ({ ...branding, refresh }),
    [branding, refresh],
  );

  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): PublicBranding & {
  refresh: () => Promise<void>;
} {
  return useContext(BrandingContext);
}
