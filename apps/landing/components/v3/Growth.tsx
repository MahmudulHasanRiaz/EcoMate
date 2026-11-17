'use client';

/** v3 growth sections (mockup §§07–10 + getting started). All presentational. */
import React from 'react';
import { useLanding } from '@/components/shell/useLanding';
import { SectionHead, SectionShell } from './SectionHead';

export function MkOmnichannel() {
  const { content } = useLanding();
  const omni = content.omnichannel;

  return (
    <SectionShell id="warehouse">
      <SectionHead
        index={omni.index}
        eyebrow={omni.eyebrow}
        title={omni.heading}
        sub={omni.subheading}
      />
      <div className="mk-g mk-c2">
        <div className="mk-pn">
          <p className="mk-pt">{omni.warehouseTitle}</p>
          <div className="mk-row">
            <span>{omni.warehousePath[0]}</span>
            <strong>→ {omni.warehousePath.slice(1).join(' → ')}</strong>
          </div>
          {omni.warehousePath.length > 2 && (
            <div className="mk-row">
              <span>{omni.warehousePath[2]}</span>
              <strong>→ {omni.warehousePath.slice(3).join(' → ')}</strong>
            </div>
          )}
          <ul className="mk-check" style={{ marginTop: 8 }}>
            {omni.warehouseRows.map((row) => (
              <li key={row}>{row}</li>
            ))}
          </ul>
        </div>
        <div className="mk-pn">
          <p className="mk-pt">{omni.posTitle}</p>
          <ul className="mk-check">
            {omni.posRows.map((row) => (
              <li key={row}>{row}</li>
            ))}
          </ul>
        </div>
      </div>
      <a href="#demo" className="mk-demo-link">
        {omni.demoCta}
      </a>
    </SectionShell>
  );
}

export function MkFinance() {
  const { content } = useLanding();
  const finance = content.profitClarity;

  const toneColor = (tone: 'in' | 'out' | 'net'): string =>
    tone === 'in' || tone === 'net' ? 'var(--mk-ok)' : 'inherit';

  return (
    <SectionShell id="profit">
      <SectionHead
        index={finance.index}
        eyebrow={finance.eyebrow}
        title={finance.heading}
        sub={finance.subheading}
      />
      <div className="mk-g mk-c2">
        <div className="mk-pn">
          <div className="mk-row">
            <span>{finance.orderLabel}</span>
            <strong>{finance.orderId}</strong>
          </div>
          {finance.rows.map((row) => (
            <div key={row.label} className="mk-row">
              <span>{row.label}</span>
              <strong style={{ color: toneColor(row.tone) }}>{row.value}</strong>
            </div>
          ))}
          <p className="mk-strip">{finance.sampleNote}</p>
        </div>
        <div className="mk-pn">
          <p className="mk-pt">{finance.paymentsTitle}</p>
          <ul className="mk-check">
            {finance.paymentsRows.map((row) => (
              <li key={row}>{row}</li>
            ))}
          </ul>
        </div>
      </div>
      <a href="#demo" className="mk-demo-link">
        {finance.demoCta}
      </a>
    </SectionShell>
  );
}

export function MkTeam() {
  const { content } = useLanding();
  const team = content.teamOps;

  return (
    <SectionShell id="team">
      <SectionHead
        index={team.index}
        eyebrow={team.eyebrow}
        title={team.heading}
        sub={team.subheading}
      />
      <div className="mk-g mk-c2">
        <div className="mk-pn">
          <ul className="mk-check">
            {team.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>
        <div className="mk-pn">
          <p className="mk-pt">{team.timelineTitle}</p>
          {team.timeline.map((entry) => (
            <div key={`${entry.time}-${entry.text}`} className="mk-row">
              <span>{entry.time}</span>
              <strong>{entry.text}</strong>
            </div>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

export function MkInfra() {
  const { content } = useLanding();
  const infra = content.infraTrack;

  return (
    <SectionShell id="infra">
      <SectionHead
        index={infra.index}
        eyebrow={infra.eyebrow}
        title={infra.heading}
        sub={infra.subheading}
      />
      <div className="mk-g mk-c2">
        <div className="mk-pn">
          <ul className="mk-check">
            {infra.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>
        <div className="mk-pn">
          <p className="mk-pt">{infra.trackingTitle}</p>
          <div className="mk-row">
            <span>{infra.orderLabel}</span>
            <strong>{infra.orderId}</strong>
          </div>
          <div className="mk-row">
            <span>{infra.statusLabel}</span>
            <strong style={{ color: 'var(--mk-ok)' }}>{infra.statusValue}</strong>
          </div>
          <p className="mk-strip">{infra.trackingNote}</p>
        </div>
      </div>
    </SectionShell>
  );
}

export function MkGettingStarted() {
  const { content } = useLanding();
  const getting = content.gettingStarted;

  return (
    <SectionShell id="start">
      <SectionHead
        eyebrow={getting.eyebrow}
        title={getting.heading}
        sub={getting.subheading}
      />
      <ol className="mk-g mk-c3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {getting.steps.map((step) => (
          <li key={step.stepNumber} className="mk-pn">
            <p className="mk-big">{step.stepNumber}</p>
            <p style={{ fontWeight: 600 }}>{step.title}</p>
            <p style={{ color: 'var(--mk-mu)', fontSize: 14, margin: '6px 0 0' }}>{step.detail}</p>
          </li>
        ))}
      </ol>
      <div style={{ marginTop: 22 }}>
        {/* SaaS: the steps end at signup, not the lead form. */}
        <a href="/signup" className="mk-btn mk-btn-primary">
          {getting.ctaLabel}
        </a>
      </div>
    </SectionShell>
  );
}
