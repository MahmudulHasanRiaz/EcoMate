'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: Record<string, unknown>,
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

/**
 * Cloudflare Turnstile widget. Renders only when a public site key is
 * configured; the platform verifies the token server-side. In local dev with
 * no site key the server's CAPTCHA check is disabled as well.
 */
export function Turnstile({
  onToken,
}: {
  onToken: (token: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey || !container.current) return;
    let widgetId: string | null = null;
    let cancelled = false;

    const render = () => {
      if (cancelled || !window.turnstile || !container.current) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        theme: 'auto',
        callback: (token: string) => onToken(token),
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      });
    };

    if (window.turnstile) {
      render();
    } else {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-turnstile]',
      );
      const script = existing ?? document.createElement('script');
      if (!existing) {
        script.src =
          'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.dataset.turnstile = 'true';
        document.head.appendChild(script);
      }
      script.addEventListener('load', render);
    }

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onToken]);

  if (!siteKey) return null;
  return <div className="turnstile" ref={container} />;
}

export interface TurnstileHandle {
  /** Resolve a fresh token, `''` when Turnstile is not configured, `null` on failure. */
  getToken(): Promise<string | null>;
}

const LAZY_SCRIPT_ID = 'cf-turnstile-script';
const LAZY_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TOKEN_TIMEOUT_MS = 20_000;

let lazyScriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined')
    return Promise.reject(new Error('Turnstile requires a browser'));
  if (window.turnstile) return Promise.resolve();
  if (lazyScriptPromise) return lazyScriptPromise;

  lazyScriptPromise = new Promise<void>((resolve, reject) => {
    // The eager `Turnstile` above marks its script `data-turnstile`;
    // reuse it when present instead of loading the API twice.
    const existing =
      document.getElementById(LAZY_SCRIPT_ID) ??
      document.querySelector<HTMLScriptElement>('script[data-turnstile]');
    const script =
      existing instanceof HTMLScriptElement
        ? existing
        : document.createElement('script');
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => {
        lazyScriptPromise = null;
        script.remove();
        reject(new Error('Turnstile script failed to load'));
      },
      { once: true },
    );
    if (!(existing instanceof HTMLScriptElement)) {
      script.id = LAZY_SCRIPT_ID;
      script.src = LAZY_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  return lazyScriptPromise;
}

/**
 * Lazy Turnstile for the home-page lead form (same pattern as the
 * EcoMate-Landing reference): nothing loads or renders on page visit.
 * The script loads and the widget renders only when `getToken()` is
 * called on submit, with `appearance: 'interaction-only'` — the widget
 * stays hidden unless Cloudflare actually needs an interaction, so a
 * plain home-page visit never triggers a challenge.
 *
 * When `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset (local dev), the
 * component renders nothing and `getToken()` resolves `''`; the server
 * skips verification for the same reason.
 */
export const LazyTurnstile = forwardRef<TurnstileHandle, { className?: string }>(
  function LazyTurnstile({ className }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<string | null>(null);
    const resolveRef = useRef<((token: string | null) => void) | null>(null);

    // `process.env.NEXT_PUBLIC_*` is inlined by Next at build time.
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

    const getToken = useCallback(async (): Promise<string | null> => {
      if (siteKey === '') return '';

      try {
        await loadTurnstileScript();
      } catch (error) {
        console.warn('[turnstile] script unavailable:', error);
        return null;
      }

      const api = window.turnstile;
      const container = containerRef.current;
      if (!api || !container) return null;

      return new Promise<string | null>((resolve) => {
        const wrapper = (token: string | null): void => {
          window.clearTimeout(timeout);
          resolveRef.current = null;
          resolve(token);
        };
        const timeout = window.setTimeout(() => wrapper(null), TOKEN_TIMEOUT_MS);
        resolveRef.current = wrapper;

        if (widgetIdRef.current === null) {
          widgetIdRef.current = api.render(container, {
            sitekey: siteKey,
            appearance: 'interaction-only',
            callback: (token: string) => resolveRef.current?.(token),
            'error-callback': () => {
              resolveRef.current?.(null);
              return true;
            },
            'timeout-callback': () => resolveRef.current?.(null),
          });
        } else {
          // A solved token is single-use: force a fresh challenge for this submission.
          api.reset(widgetIdRef.current);
        }
      });
    }, [siteKey]);

    useImperativeHandle(ref, () => ({ getToken }), [getToken]);

    useEffect(
      () => () => {
        const api = window.turnstile;
        if (api && widgetIdRef.current !== null) {
          try {
            api.remove(widgetIdRef.current);
          } catch {
            // The widget is already gone (script unloaded, navigation): nothing to clean up.
          }
        }
        widgetIdRef.current = null;
        resolveRef.current = null;
      },
      [],
    );

    if (siteKey === '') return null;
    return <div ref={containerRef} className={className} />;
  },
);
