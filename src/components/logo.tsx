
/** @jsxImportSource react */
'use client';

import Image from 'next/image';
import React from 'react';

type LogoProps = {
    variant?: 'icon' | 'full' | 'white';
    className?: string;
    size?: number; // overrides default size in px for icon/white/full height
    srcOverride?: string; // prefer this src to avoid client fetch
};

const defaults = {
  icon: '/logo-icon.svg',
  full: '/logo-full.svg',
  white: '/logo-white.svg',
};

export function Logo({ variant = 'icon', className, size, srcOverride }: LogoProps) {
  const initialSrc = srcOverride || defaults[variant] || defaults.icon;
  const [src, setSrc] = React.useState<string>(initialSrc);
  const fallbackWidth = variant === 'full' || variant === 'white' ? 120 : 48;
  const fallbackHeight = variant === 'full' || variant === 'white' ? 36 : 48;
  const width = size ?? fallbackWidth;
  const height = size
    ? variant === 'full' || variant === 'white'
      ? Math.round(size * (fallbackHeight / fallbackWidth))
      : size
    : fallbackHeight;

  React.useEffect(() => {
    if (srcOverride) {
      setSrc(srcOverride);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/settings/branding', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (!data || Object.keys(data).length === 0) return;
        const nextSrc =
          variant === 'full'
            ? data.standardLogoUrl || data.darkLogoUrl || defaults.full
            : variant === 'white'
              ? data.darkLogoUrl || data.standardLogoUrl || defaults.white
              : data.iconLogoUrl || data.standardLogoUrl || defaults.icon;
        if (!cancelled) setSrc(nextSrc);
      } catch {
        // ignore; keep default
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [variant, srcOverride]);

  const roundedClass = variant === 'full' ? 'rounded-md' : 'rounded-full';
  const paddingClass = variant === 'full' ? 'p-1' : 'p-1';

  return (
    <span
      className={`inline-flex items-center justify-center border bg-white ${roundedClass} ${paddingClass} ${className || ''}`}
      style={{ width, height }}
    >
      <Image
        src={src}
        alt="EcoMate Logo"
        width={width}
        height={height}
        className={`${roundedClass}`}
        style={{ objectFit: 'contain', width: '100%', height: '100%' }}
        priority
      />
    </span>
  );
}
