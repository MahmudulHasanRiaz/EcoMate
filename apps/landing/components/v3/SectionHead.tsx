import React from 'react';

/** Numbered section heading, mirroring the mockup's `01 · eyebrow` + h2 + sub. */
export function SectionHead({
  index,
  eyebrow,
  title,
  sub,
}: {
  index?: string;
  eyebrow: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="mk-hd">
      <p className="mk-eyebrow">
        {index && (
          <>
            <span className="mk-secnum">{index} · </span>
          </>
        )}
        {eyebrow}
      </p>
      <h2 className="mk-h2">{title}</h2>
      {sub.trim().length > 0 && <p className="mk-sb">{sub}</p>}
    </div>
  );
}

/** Mockup section shell: id anchor + top border + 1120px container. */
export function SectionShell({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mk-s">
      <div className="mk-w">{children}</div>
    </section>
  );
}
