/**
 * Theme resolution (StackMate Neon pattern, adapted for EcoMate).
 *
 * Stored choice (`ecomate.platform.theme`): "system" | "dark" | "light".
 * No stored value → "dark" (Neon is dark-first). "system" follows
 * prefers-color-scheme, live — a matchMedia listener re-applies the
 * effective theme when the OS preference changes while the choice is
 * "system". The effective value is applied to <html data-theme="...">
 * before React mounts (see index.html inline script + main.tsx) so
 * there is no flash of the wrong theme.
 */
export type ThemeChoice = 'system' | 'dark' | 'light';
export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'ecomate.platform.theme';
export const DEFAULT_THEME_CHOICE: ThemeChoice = 'dark';

export function resolveThemeChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'system' || stored === 'dark' || stored === 'light') {
      return stored;
    }
  } catch {
    /* storage unavailable — fall through to the default */
  }
  return DEFAULT_THEME_CHOICE;
}

export function resolveEffectiveTheme(choice: ThemeChoice): Theme {
  if (choice === 'dark' || choice === 'light') return choice;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }
  return 'dark';
}

let systemListener: MediaQueryList | null = null;

function onSystemPreferenceChange(): void {
  if (resolveThemeChoice() !== 'system') return;
  document.documentElement.setAttribute(
    'data-theme',
    resolveEffectiveTheme('system'),
  );
}

export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.setAttribute(
    'data-theme',
    resolveEffectiveTheme(choice),
  );
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* storage unavailable — the attribute still applies for this load */
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    if (choice === 'system') {
      if (!systemListener) {
        systemListener = mq;
        if (typeof mq.addEventListener === 'function') {
          mq.addEventListener('change', onSystemPreferenceChange);
        }
      }
    } else if (systemListener) {
      if (typeof systemListener.removeEventListener === 'function') {
        systemListener.removeEventListener('change', onSystemPreferenceChange);
      }
      systemListener = null;
    }
  }
}

export function nextThemeChoice(choice: ThemeChoice): ThemeChoice {
  // Cycle dark -> light -> system -> dark (the toggle in the shell).
  if (choice === 'dark') return 'light';
  if (choice === 'light') return 'system';
  return 'dark';
}

export function themeChoiceLabel(choice: ThemeChoice): string {
  if (choice === 'dark') return 'Dark';
  if (choice === 'light') return 'Light';
  return 'System';
}
