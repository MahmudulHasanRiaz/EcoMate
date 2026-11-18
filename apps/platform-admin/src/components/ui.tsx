import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import { formatStatus, statusTone } from '../lib/format';

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge badge--${statusTone(status)}`}>
      {formatStatus(status)}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="page-sub">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <p className="muted-note">{label}</p>;
}

/**
 * Skeleton loading bars (live StackMate settings): ~5–6 full-width grey
 * bars (~24px high, gap ~16) shown while a page loads, instead of a
 * bare "Loading…" line. `rows` defaults to 5; the last bar is short.
 */
export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-label="Loading" role="status">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={`skeleton-bar${index === rows - 1 ? ' skeleton-bar--short' : ''}`}
        />
      ))}
    </div>
  );
}

/**
 * Shared empty state (live StackMate pattern): centred icon + 14px
 * semibold title + 13px muted body, ~48px top padding. The body
 * (children) carries the explanation and any action link.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">
        <Icon size={20} strokeWidth={2} />
      </span>
      <p className="empty-state-title">{title}</p>
      {children ? <div className="empty-state-body">{children}</div> : null}
    </div>
  );
}

/**
 * Shared list pager (live StackMate footer): "Showing A–B of N" (13px
 * muted) left, rows-per-page select (~28px) + Prev/Next (~28px) right.
 * Used by Tenants, Leads and Audit — the three paged lists.
 */
export function Pager({
  page,
  totalPages,
  total,
  limit,
  onPage,
  onLimit,
}: {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPage: (page: number) => void;
  onLimit: (limit: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const last = Math.max(1, totalPages);
  return (
    <div className="pager">
      <span className="pager-count">
        Showing {from}–{to} of {total}
      </span>
      <label className="pager-size">
        <span>Rows per page</span>
        <select
          value={limit}
          onChange={(event) => onLimit(Number(event.target.value))}
          aria-label="Rows per page"
        >
          {[10, 20, 50].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="button button--ghost button--sm"
        disabled={page <= 1}
        onClick={() => onPage(Math.max(1, page - 1))}
      >
        Previous
      </button>
      <button
        type="button"
        className="button button--ghost button--sm"
        disabled={page >= last}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="notice notice--error" role="alert">
      {message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* In-app feedback primitives (StackMate Neon, adapted).               */
/*                                                                     */
/* The console previously had NO toast/modal system — only inline      */
/* notice divs — which is why destructive actions fell back to the     */
/* browser's own native confirm dialog. These primitives replace all   */
/* native dialogs (Boss rule: everything in-app, never browser dialogs). */
/* ------------------------------------------------------------------ */

export type ToastTone = 'info' | 'success' | 'error';

type ToastItem = { id: number; tone: ToastTone; message: string };

const ToastContext = createContext<{
  pushToast: (message: string, tone?: ToastTone) => void;
}>({ pushToast: () => undefined });

export function useToast() {
  return useContext(ToastContext);
}

const TOAST_TTL_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const pushToast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, TOAST_TTL_MS);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast${toast.tone === 'info' ? '' : ` toast--${toast.tone}`}`}
            role={toast.tone === 'error' ? 'alert' : 'status'}
          >
            <p>{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Controlled in-app confirmation. Replaces every native confirm dialog in
 * the console. `danger` renders the confirm action as the solid red button
 * (Neon rule) and `dangerNote` renders the red warning panel above the
 * buttons (the StackMate "danger-warning" pattern). A non-danger confirm
 * is the OUTLINE ACCENT button — live StackMate's dialog main action.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  dangerNote,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  dangerNote?: string;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        {typeof body === 'string' ? <p>{body}</p> : body}
        {dangerNote ? (
          <div className="dialog-warning">{dangerNote}</div>
        ) : null}
        <div className="dialog-actions">
          <button
            type="button"
            className="button"
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={
              danger ? 'button button--danger-solid' : 'button button--accent'
            }
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Generic in-app modal shell (forms, previews, prompt replacement). */
export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className={`dialog${wide ? ' dialog--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * Horizontally scrollable tab strip (R-BILLING-TABS).
 *
 * `.tabs` scrolls natively (`overflow-x: auto`) but hides its scrollbar,
 * so on desktop there was no way to reach cut-off tabs: no visible
 * scrollbar, and dragging a scroll container does nothing with a mouse.
 * This wrapper adds ‹ › buttons that appear only while there is more to
 * scroll in that direction, plus a fade at the overflowing edge. The
 * buttons scroll by ~80% of the visible width; keyboard users can still
 * Tab through the tab buttons (focus scrolls the strip into view).
 */
export function ScrollableTabs({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const update = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    update();
    const el = stripRef.current;
    if (!el) return;
    window.addEventListener('resize', update);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(el);
    }
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [update, children]);

  const scrollBy = (direction: 1 | -1) => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(160, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <div
      className="tabs-scroll"
      data-can-left={canScrollLeft}
      data-can-right={canScrollRight}
    >
      {canScrollLeft ? (
        <button
          type="button"
          className="tabs-scroll-btn tabs-scroll-btn--left"
          onClick={() => scrollBy(-1)}
          aria-label="Scroll tabs left"
        >
          ‹
        </button>
      ) : null}
      <div
        className="tabs"
        role="tablist"
        aria-label={label}
        ref={stripRef}
        onScroll={update}
      >
        {children}
      </div>
      {canScrollRight ? (
        <button
          type="button"
          className="tabs-scroll-btn tabs-scroll-btn--right"
          onClick={() => scrollBy(1)}
          aria-label="Scroll tabs right"
        >
          ›
        </button>
      ) : null}
    </div>
  );
}
