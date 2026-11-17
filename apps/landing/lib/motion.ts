/**
 * D1 central motion tokens (fix/perf-overhaul) — the ONLY durations/easings in the app.
 *
 * - CSS vars (`--motion-*`) are the runtime source; this module is the typed mirror for
 *   JS (IO helper delays, stagger math). Scattered magic numbers are forbidden — import
 *   from here or use the vars.
 * - GPU-composited ONLY: `transform` + `opacity`. Animating layout properties (width,
 *   height, top/left, grid-template-*) is forbidden — it forces layout per frame and
 *   regresses CLS/INP on low-end devices.
 * - `prefers-reduced-motion` is the global kill-switch (see `app/globals.css`): all
 *   transitions/animations collapse to ~0ms there. JS helpers must check
 *   `prefersReducedMotion()` and skip observation/delays (see `components/motion/Reveal`).
 */
export const MOTION = {
  durationInstantMs: 100,
  durationFastMs: 160,
  durationBaseMs: 240,
  durationSlowMs: 360,
  easingStandard: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  easingEmphasized: 'cubic-bezier(0.32, 0.72, 0, 1)',
  staggerStepMs: 60,
  revealDistancePx: 16,
  hoverLiftPx: 4,
  pressScale: 0.97,
} as const;

export const MOTION_CSS_VARS = {
  durationFast: 'var(--motion-duration-fast)',
  durationBase: 'var(--motion-duration-base)',
  durationSlow: 'var(--motion-duration-slow)',
  easingStandard: 'var(--motion-easing-standard)',
  easingEmphasized: 'var(--motion-easing-emphasized)',
} as const;

export function prefersReducedMotion(): boolean {
  const mm =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia.bind(window)
      : typeof globalThis !== 'undefined' &&
          typeof (globalThis as { matchMedia?: unknown }).matchMedia === 'function'
        ? (globalThis as { matchMedia: (q: string) => { matches: boolean } }).matchMedia.bind(
            globalThis,
          )
        : null;
  if (!mm) return false;
  try {
    return mm('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Stagger delay for item `index` (capped so long lists don't drift). */
export function staggerDelayMs(index: number, stepMs = MOTION.staggerStepMs): number {
  return Math.min(index, 8) * stepMs;
}
