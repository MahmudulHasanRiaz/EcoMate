import type { ReactNode } from 'react';
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
