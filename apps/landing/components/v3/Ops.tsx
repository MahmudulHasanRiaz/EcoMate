'use client';

/**
 * v3 ops sections (mockup §§01–06): fragmented reality, packing terminal,
 * revenue ledger, logistics, ad defense, storefront.
 *
 * Demos reuse the pure logic in `lib/demoLogic.ts`; state here is local only,
 * keyboard operable, and announced via `aria-live` regions.
 */
import React, { useState } from 'react';
import { useLanding } from '@/components/shell/useLanding';
import {
  confirmBooking,
  initialBookingState,
  initialPackingState,
  scanPackingItem,
  selectCourier,
  toggleStore,
} from '@/lib/demoLogic';
import { SectionHead, SectionShell } from './SectionHead';

export function MkFragmented() {
  const { content } = useLanding();
  const fragmented = content.fragmented;

  return (
    <SectionShell id="why">
      <SectionHead
        index={fragmented.index}
        eyebrow={fragmented.eyebrow}
        title={fragmented.heading}
        sub={fragmented.subheading}
      />
      <div className="mk-g mk-c2">
        <div className="mk-pn">
          <p className="mk-pt">✕ {fragmented.beforeTitle}</p>
          <ul className="mk-check mk-check-bad">
            {fragmented.beforeItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="mk-pn mk-pn-hl">
          <p className="mk-pt">✓ {fragmented.afterTitle}</p>
          <ul className="mk-check">
            {fragmented.afterItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </SectionShell>
  );
}

export function MkPacking() {
  const { content } = useLanding();
  const packing = content.packingTerminal;
  const total = packing.items.length;
  const [pack, setPack] = useState(initialPackingState);
  // Button 1 scans the pending item in order; button 2 always scans ahead, so
  // it trips the mismatch state — the `scanPackingItem` order rule.
  const verified = pack.scanned.includes(0);
  const wrong = pack.blocked;
  const handleCorrect = () => setPack((prev) => scanPackingItem(prev, 0, total));
  // An out-of-range index never equals the next expected position, so the
  // wrong-size button always trips the mismatch state (and no-ops once done).
  const handleWrong = () => setPack((prev) => scanPackingItem(prev, total, total));

  return (
    <SectionShell id="packing">
      <SectionHead
        index={packing.index}
        eyebrow={packing.eyebrow}
        title={packing.heading}
        sub={packing.subheading}
      />
      <div className="mk-g mk-c2">
        <div className="mk-pn" data-testid="packing-terminal">
          <p className="mk-pt">{packing.terminalTitle}</p>
          <div className="mk-row">
            <span>{packing.orderLabel}</span>
            <strong>{packing.orderId}</strong>
          </div>
          {packing.items.map((item, i) => {
            const done = verified && i === 0;
            return (
              <div key={item.sku} className="mk-row">
                <span>
                  {item.name} · {item.sku}
                </span>
                <strong style={done ? { color: 'var(--mk-ok)' } : undefined}>
                  {done ? packing.matchedLabel : packing.waitingLabel}
                </strong>
              </div>
            );
          })}
          <div className="mk-row">
            <span>{packing.boxSealLabel}</span>
            <strong style={verified ? { color: 'var(--mk-ok)' } : undefined}>
              {verified ? packing.unlockedLabel : packing.lockedLabel}
            </strong>
          </div>
          <div aria-live="polite">
            {wrong && (
              <div className="mk-row">
                <span>{packing.items[1]?.sku}</span>
                <strong style={{ color: 'var(--mk-bad)' }}>{packing.wrongLabel}</strong>
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            <button type="button" className="mk-btn mk-btn-block" onClick={handleCorrect} disabled={verified}>
              {packing.scanCorrectLabel}
            </button>
            <button type="button" className="mk-btn mk-btn-block" onClick={handleWrong}>
              {packing.scanWrongLabel}
            </button>
          </div>
          <p className="mk-strip">{packing.sampleNote}</p>
        </div>
        <div className="mk-pn">
          <ul className="mk-check">
            {packing.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>
      </div>
      <a href="#demo" className="mk-demo-link">
        {packing.demoCta}
      </a>
    </SectionShell>
  );
}

export function MkRevenue() {
  const { content } = useLanding();
  const revenue = content.revenueLedger;
  const [courierId, setCourierId] = useState(revenue.couriers[0]?.id ?? '');
  const [policyId, setPolicyId] = useState(revenue.policies[0]?.id ?? '');

  const selected = revenue.couriers.find((c) => c.id === courierId) ?? revenue.couriers[0];

  return (
    <SectionShell id="courier">
      <SectionHead
        index={revenue.index}
        eyebrow={revenue.eyebrow}
        title={revenue.heading}
        sub={revenue.subheading}
      />
      <div className="mk-g mk-c2">
        <div className="mk-pn">
          <p className="mk-pt">{revenue.ledgerTitle}</p>
          <div className="mk-row">
            <span>{revenue.phoneLabel}</span>
            <strong>{revenue.phone}</strong>
          </div>
          <div className="mk-row">
            <span>{revenue.totalsLabel}</span>
            <strong>
              {revenue.totals.total} · {revenue.totals.delivered} · {revenue.totals.returned}
            </strong>
          </div>
          <div className="mk-tabs" role="radiogroup" aria-label={revenue.ledgerTitle} style={{ marginTop: 12 }}>
            {revenue.couriers.map((courier) => (
              <button
                key={courier.id}
                type="button"
                role="radio"
                aria-checked={courier.id === courierId}
                data-on={courier.id === courierId}
                className="mk-tab"
                onClick={() => setCourierId(courier.id)}
              >
                {courier.name}
              </button>
            ))}
          </div>
          {selected && (
            <div aria-live="polite">
              <div className="mk-row">
                <span>{revenue.deliveredLabel}</span>
                <strong>
                  {selected.delivered} / {selected.returned}
                </strong>
              </div>
              <div className="mk-bar" aria-hidden="true">
                <i style={{ width: `${Math.round((Number(selected.returned) / Math.max(1, Number(selected.delivered) + Number(selected.returned))) * 100)}%`, background: 'var(--mk-wn)' }} />
              </div>
              <p className="mk-strip" style={{ marginTop: 4 }}>
                {selected.rateNote}
              </p>
            </div>
          )}
        </div>
        <div className="mk-pn">
          <p className="mk-pt">{revenue.policyTitle}</p>
          <div role="radiogroup" aria-label={revenue.policyTitle}>
            {revenue.policies.map((policy) => (
              <button
                key={policy.id}
                type="button"
                role="radio"
                aria-checked={policy.id === policyId}
                data-on={policy.id === policyId}
                className="mk-opt"
                onClick={() => setPolicyId(policy.id)}
              >
                {policy.label}
              </button>
            ))}
          </div>
          <p className="mk-strip">{revenue.policyNote}</p>
        </div>
      </div>
    </SectionShell>
  );
}

export function MkLogistics() {
  const { content } = useLanding();
  const logistics = content.logistics;
  const [booking, setBooking] = useState(initialBookingState);

  const selectedId = booking.selectedId ?? logistics.couriers[0]?.id ?? '';

  return (
    <SectionShell id="dispatch">
      <SectionHead
        index={logistics.index}
        eyebrow={logistics.eyebrow}
        title={logistics.heading}
        sub={logistics.subheading}
      />
      <div className="mk-g mk-c2">
        <div className="mk-pn">
          <div className="mk-tabs" role="radiogroup" aria-label={logistics.bulkTitle}>
            {logistics.couriers.map((courier) => (
              <button
                key={courier.id}
                type="button"
                role="radio"
                aria-checked={courier.id === selectedId}
                data-on={courier.id === selectedId}
                className="mk-tab"
                onClick={() => setBooking((prev) => selectCourier(prev, courier.id))}
              >
                {courier.name}
              </button>
            ))}
          </div>
          <p className="mk-pt">{logistics.bulkTitle}</p>
          <div className="mk-row">
            <span>✓ {logistics.selectedCount}</span>
            <strong>{logistics.selectedLabel}</strong>
          </div>
          <div className="mk-row">
            <span>{logistics.mixLabel}</span>
            <strong>{logistics.mixValue}</strong>
          </div>
          <button
            type="button"
            className="mk-btn mk-btn-primary mk-btn-block"
            style={{ marginTop: 12 }}
            disabled={booking.booked}
            onClick={() => setBooking((prev) => confirmBooking({ ...prev, selectedId })) }
          >
            {booking.booked ? `✓ ${logistics.pushLabel}` : logistics.pushLabel}
          </button>
          <p className="mk-strip">{logistics.sampleNote}</p>
        </div>
        <div className="mk-pn">
          <p className="mk-pt">{logistics.streamTitle}</p>
          {logistics.streamRows.map((row) => (
            <div key={row.ref} className="mk-row">
              <span>
                {row.time} · {row.ref} {row.courier}
              </span>
              <strong>{row.status}</strong>
            </div>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

export function MkAdDefense() {
  const { content } = useLanding();
  const defense = content.adDefense;
  const recommended = defense.modes.find((mode) => mode.recommended) ?? defense.modes[0];
  const [modeId, setModeId] = useState(recommended?.id ?? '');

  const selected = defense.modes.find((mode) => mode.id === modeId) ?? recommended;

  return (
    <SectionShell id="capi">
      <SectionHead
        index={defense.index}
        eyebrow={defense.eyebrow}
        title={defense.heading}
        sub={defense.subheading}
      />
      <div className="mk-g mk-c2">
        <div className="mk-pn">
          <div role="radiogroup" aria-label={defense.eyebrow}>
            {defense.modes.map((mode) => (
              <React.Fragment key={mode.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode.id === modeId}
                  data-on={mode.id === modeId}
                  className="mk-opt"
                  onClick={() => setModeId(mode.id)}
                >
                  {mode.title}
                  {mode.recommended && <span className="mk-suggest">{defense.recommendBadge}</span>}
                </button>
                {mode.id === modeId && (
                  <p className="mk-opt-detail" data-on={true} aria-live="polite">
                    {selected?.detail ?? mode.detail}
                  </p>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="mk-pn">
          <p className="mk-pt">{defense.attributionTitle}</p>
          <ul className="mk-check">
            {defense.attributionRows.map((row) => (
              <li key={row.label}>
                {row.label}
                {row.value.trim().length > 0 && ` — ${row.value}`}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <a href="#demo" className="mk-demo-link">
        {defense.demoCta}
      </a>
    </SectionShell>
  );
}

export function MkStores() {
  const { content } = useLanding();
  const stores = content.storefront;
  // Mockup default: every switch Off; flipping publishes the store.
  const [paused, setPaused] = useState<string[]>(() => stores.stores.map((store) => store.id));

  return (
    <SectionShell id="stores">
      <SectionHead
        index={stores.index}
        eyebrow={stores.eyebrow}
        title={stores.heading}
        sub={stores.subheading}
      />
      <p className="mk-strip" style={{ margin: '0 0 12px' }}>
        {stores.switchHint}
      </p>
      <div className="mk-g mk-c2">
        <div className="mk-pn">
          <p className="mk-pt">{stores.catalogTitle}</p>
          <div className="mk-row">
            <span>{stores.catalogSku}</span>
            <strong>{stores.catalogUnits}</strong>
          </div>
          {stores.stores.map((store) => {
            const on = !paused.includes(store.id);
            return (
              <div key={store.id} className="mk-row">
                <span>{store.name}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <strong style={on ? { color: 'var(--mk-ok)' } : undefined}>
                    {on ? stores.publishedLabel : stores.offLabel}
                  </strong>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${store.name} — ${on ? stores.publishedLabel : stores.offLabel}`}
                    data-on={on}
                    className="mk-sw"
                    onClick={() => setPaused((prev) => toggleStore(prev, store.id))}
                  >
                    <i aria-hidden="true" />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        <div className="mk-pn">
          <p className="mk-pt">{stores.whyTitle}</p>
          <ul className="mk-check">
            {stores.whyItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </SectionShell>
  );
}
