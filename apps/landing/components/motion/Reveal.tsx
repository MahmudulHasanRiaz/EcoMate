'use client';

/**
 * D3 staggered scroll reveal (fix/perf-overhaul): ONE tiny IntersectionObserver helper,
 * no library. `transform`/`opacity` only, fires once per element, honours the
 * `prefers-reduced-motion` kill-switch (renders visible immediately, no observer).
 *
 * Usage: `<Reveal delay={staggerDelayMs(i)}><MkCard …/></Reveal>`
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

let sharedObserver: IntersectionObserver | null = null;

function getSharedObserver(): IntersectionObserver | null {
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return null;
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            sharedObserver?.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
  }
  return sharedObserver;
}

/** Test hook: drop the shared observer between test cases. */
export function resetRevealObserverForTests(): void {
  sharedObserver?.disconnect();
  sharedObserver = null;
}

export function Reveal({
  children,
  delay = 0,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'span';
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.classList.add('is-visible');
      return;
    }
    const observer = getSharedObserver();
    if (!observer) {
      el.classList.add('is-visible');
      return;
    }
    observer.observe(el);
    return () => observer.unobserve(el);
  }, []);

  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      className={`reveal ${className}`}
      style={delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
