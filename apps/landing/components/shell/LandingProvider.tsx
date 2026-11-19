'use client';

/**
 * Locale + theme + resolved landing content, as one client context.
 *
 * Simplified from the EcoMate-Landing reference (`LocaleThemeProvider`):
 * locale is client state (routes stay unprefixed — platform email links
 * hit /verify-email), there is no router navigation, no DB menus, and no
 * separate testimonials feed. Content is the built-in fallback merged
 * with the managed payload the server fetched (see lib/landing-content);
 * when the API is down or a section is unmanaged, the fallback stands.
 *
 * Theme is dark-first: only an explicit stored 'light' choice renders
 * light; anything else (unset, private-mode denial) is dark. The
 * before-paint script in app/layout.tsx applies the same rule before
 * React mounts so there is no theme flash.
 */
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { landingContent } from '@/data/landingContent';
import type { LandingContent, Locale, Theme } from '@/lib/landingTypes';
import {
  mergeLandingContent,
  type ManagedLandingContent,
} from '@/lib/landing-content';

/** Env branding (lib/branding.ts), or null → built-in logo mark. */
export interface SiteBranding {
  siteName: string;
  logoUrl: string;
}

export interface ShellValue {
  locale: Locale;
  theme: Theme;
  /** Built-in fallback merged with managed rows for the active locale. */
  content: LandingContent;
  branding: SiteBranding | null;
  toggleLocale: () => void;
  toggleTheme: () => void;
}

export const ShellContext = createContext<ShellValue | null>(null);

export function LandingProvider({
  initialLocale = 'en',
  managed,
  branding,
  children,
}: {
  initialLocale?: Locale;
  /** Server-fetched managed payload (null when the API is down). */
  managed?: ManagedLandingContent | null;
  branding: SiteBranding | null;
  children: React.ReactNode;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  // M-31: theme persists across reloads. Lazy initializer (client-only
  // read, no SSR mismatch — the class sync effect below applies it to
  // `documentElement` after mount; the before-paint script in the layout
  // already set the same class, so there is no flash either way).
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return window.localStorage.getItem('ecomate-theme') === 'light'
        ? 'light'
        : 'dark';
    } catch {
      return 'dark';
    }
  });

  const content = useMemo(() => {
    // Visibility is locale-independent (single 'en' rows) — inject the
    // 'en' visibility map into every locale's merge, so hiding a
    // section hides it in Bangla too. Without managed rows the merge
    // leaves every section visible.
    const localeManaged = managed?.[locale];
    const visibility = managed?.en?.visibility;
    const withVisibility =
      visibility && localeManaged
        ? { ...localeManaged, visibility }
        : visibility
          ? { visibility }
          : localeManaged;
    return mergeLandingContent(landingContent[locale], withVisibility);
  }, [locale, managed]);

  const toggleLocale = useCallback(() => {
    setLocale((prev) => (prev === 'en' ? 'bn' : 'en'));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'light' ? 'dark' : 'light';
      try {
        window.localStorage.setItem('ecomate-theme', next);
      } catch {
        // Private-mode storage denial must not break the toggle.
      }
      return next;
    });
  }, []);

  // Sync document language attribute
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Sync document class list for light/dark theme
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const value = useMemo<ShellValue>(
    () => ({ locale, theme, content, branding, toggleLocale, toggleTheme }),
    [locale, theme, content, branding, toggleLocale, toggleTheme],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
