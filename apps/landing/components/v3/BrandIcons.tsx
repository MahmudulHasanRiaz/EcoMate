/**
 * Brand + action icons for the contact widget.
 *
 * The WhatsApp and Messenger paths are the official logo paths copied verbatim
 * from the reference mockup (`draft/Main.dc.html`), rendered with `fill #fff`
 * exactly as the mockup does. The calendar / phone / chat paths are the
 * mockup's own geometric action icons (no brand exists for those actions, so
 * generic strokes are correct there). Never substitute lucide generics for a
 * brand logo.
 */
import React from 'react';

function Base({
  size,
  label,
  filled,
  children,
}: {
  size: number;
  label?: string;
  filled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? '#fff' : 'none'}
      stroke={filled ? undefined : 'currentColor'}
      strokeWidth={filled ? undefined : 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label === undefined ? true : undefined}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
    >
      {children}
    </svg>
  );
}

/** Official WhatsApp logo (mockup path, fill #fff). */
export function WhatsAppIcon({ size = 17 }: { size?: number }) {
  return (
    <Base size={size} filled>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </Base>
  );
}

/** Official Messenger logo (mockup path, fill #fff). */
export function MessengerIcon({ size = 17 }: { size?: number }) {
  return (
    <Base size={size} filled>
      <path d="M.001 11.639C.001 4.949 5.241 0 12.001 0S24 4.95 24 11.639c0 6.689-5.24 11.638-12 11.638-1.21 0-2.38-.16-3.47-.46a.96.96 0 00-.64.05l-2.39 1.05a.96.96 0 01-1.35-.85l-.07-2.14a.97.97 0 00-.32-.68A11.39 11.389 0 01.002 11.64zm8.32-2.19l-3.52 5.6c-.35.53.32 1.139.82.75l3.79-2.87c.26-.2.6-.2.87 0l2.8 2.1c.84.63 2.04.4 2.6-.48l3.52-5.6c.35-.53-.32-1.13-.82-.75l-3.79 2.87c-.25.2-.6.2-.86 0l-2.8-2.1a1.8 1.8 0 00-2.61.48z" />
    </Base>
  );
}

/** Geometric calendar glyph (mockup path) — the demo-book action. */
export function CalendarIcon({ size = 17 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M3 5h18v16H3zM8 3v4M16 3v4M3 11h18" />
    </Base>
  );
}

/** Geometric phone glyph (mockup path) — the call action. */
export function CallIcon({ size = 17 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z" />
    </Base>
  );
}

/** Geometric chat glyph (mockup path) — the FAB toggle. */
export function ChatIcon({ size = 20 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" />
    </Base>
  );
}

/** Geometric close glyph (mockup path) — the open FAB toggle. */
export function CloseIcon({ size = 20 }: { size?: number }) {
  return (
    <Base size={size}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Base>
  );
}
