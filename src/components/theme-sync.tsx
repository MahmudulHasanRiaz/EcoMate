'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';

type ThemeValue = 'light' | 'dark' | 'system';

type ThemeSyncProps = {
  theme: ThemeValue;
};

export function ThemeSync({ theme }: ThemeSyncProps) {
  const { setTheme } = useTheme();

  useEffect(() => {
    let cancelled = false;
    const fallbackTheme: ThemeValue = theme || 'system';

    const applyTheme = async () => {
      let targetTheme: ThemeValue = fallbackTheme;

      try {
        const res = await fetch('/api/settings/general', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          const candidate = data?.theme;
          if (candidate === 'light' || candidate === 'dark' || candidate === 'system') {
            targetTheme = candidate;
          }
        }
      } catch {
        // Ignore network errors and keep fallback theme.
      }

      if (!cancelled) {
        setTheme(targetTheme);
      }
    };

    applyTheme();

    return () => {
      cancelled = true;
    };
  }, [setTheme, theme]);

  return null;
}
