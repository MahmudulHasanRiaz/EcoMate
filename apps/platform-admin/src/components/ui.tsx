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
 * buttons (the StackMate "danger-warning" pattern).
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
              danger ? 'button button--danger-solid' : 'button button--primary'
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
