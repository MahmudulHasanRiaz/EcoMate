import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useAuth } from '../auth';
import { ConfirmDialog, ErrorNote, Skeleton } from '../components/ui';
import { errorMessage, readJson } from '../lib/api';
import { formatDate, formatDateTime, formatMoney } from '../lib/format';
import type {
  EmailBalance,
  SaasSmtpSettings,
} from '../types';

interface TopUpHistoryRow {
  id: string;
  emailsGranted: number;
  amountBDT: number | string;
  status: string;
  createdAt: string;
  paidAt: string | null;
  invoice: { id: string; number: string; status: string };
}

function emailsForAmount(
  amountBDT: number,
  unit: 'PER_EMAIL' | 'PER_1000',
  pricePerUnit: number | null,
): number {
  if (
    typeof pricePerUnit !== 'number' ||
    !Number.isFinite(pricePerUnit) ||
    pricePerUnit <= 0
  ) {
    return 0;
  }
  const amountMicro = Math.round(amountBDT * 1_000_000);
  const priceMicro = Math.round(pricePerUnit * 1_000_000);
  if (amountMicro <= 0 || priceMicro <= 0) return 0;
  return Math.floor((amountMicro * (unit === 'PER_1000' ? 1000 : 1)) / priceMicro);
}

/**
 * Email balance card for the tenant detail page (smtp-balance-design.md
 * §13): the balance (a count, never money), the lots behind it, the
 * ledger, top-up creation, and the SUPERADMIN-only manual adjustment.
 * The top-up history below is operator-only and shows the payment
 * amounts — the tenant never sees this page.
 */
export function TenantEmailBalanceCard({ tenantId }: { tenantId: string }) {
  const { api, session } = useAuth();
  const isSuperadmin = session?.user.role === 'SUPERADMIN';
  const canTopUp =
    session?.user.role === 'SUPERADMIN' || session?.user.role === 'BILLING';
  const [balance, setBalance] = useState<EmailBalance | null>(null);
  const [rate, setRate] = useState<SaasSmtpSettings | null>(null);
  const [history, setHistory] = useState<TopUpHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpBusy, setTopUpBusy] = useState(false);
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [confirmAdjust, setConfirmAdjust] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api(`/tenants/${tenantId}/email-balance`).then((r) =>
        readJson<EmailBalance>(r),
      ),
      api('/settings/saas-smtp').then((r) =>
        readJson<SaasSmtpSettings>(r),
      ),
      api(`/tenants/${tenantId}/email-topups?limit=5`).then((r) =>
        readJson<{ data: TopUpHistoryRow[] }>(r),
      ),
    ])
      .then(([balanceResult, rateResult, historyResult]) => {
        if (cancelled) return;
        setBalance(balanceResult);
        setRate(rateResult);
        setHistory(historyResult.data);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, tenantId, reload]);

  async function createTopUp() {
    const amount = Number(topUpAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter an amount greater than 0.');
      return;
    }
    setTopUpBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api(`/tenants/${tenantId}/email-topups`, {
        method: 'POST',
        body: JSON.stringify({ amountBDT: amount }),
      }).then((r) => readJson<{ invoiceNumber: string; emailsGranted: number }>(r));
      setTopUpAmount('');
      setNotice(
        `Top-up invoice ${created.invoiceNumber} created for ${created.emailsGranted.toLocaleString('en-US')} emails. The emails land in the balance once the payment proof is approved.`,
      );
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTopUpBusy(false);
    }
  }

  async function applyAdjust() {
    const delta = Number(adjustDelta);
    if (!Number.isInteger(delta) || delta === 0) {
      setError('Adjustment must be a non-zero whole number of emails.');
      return;
    }
    if (!adjustReason.trim()) {
      setError('A reason is required for a manual adjustment.');
      return;
    }
    setAdjustBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api(`/tenants/${tenantId}/email-balance/adjust`, {
        method: 'POST',
        body: JSON.stringify({ delta, reason: adjustReason.trim() }),
      }).then((r) => readJson<{ balance: number }>(r));
      setAdjustDelta('');
      setAdjustReason('');
      setConfirmAdjust(false);
      setNotice(
        `Balance adjusted by ${delta > 0 ? '+' : ''}${delta} emails (now ${result.balance.toLocaleString('en-US')}).`,
      );
      setReload((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAdjustBusy(false);
    }
  }

  const previewEmails =
    rate && topUpAmount.trim() !== ''
      ? emailsForAmount(Number(topUpAmount), rate.unit, rate.pricePerUnit)
      : 0;

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Email balance</h2>
          <p>
            Sendable emails for the shared EcoMate SMTP service — a count,
            never a money balance. The tenant tops up from their SMTP page;
            operators can create a top-up or adjust the count here.
          </p>
        </div>
        {balance ? (
          <span
            className={`badge badge--${balance.lowBalance ? 'warn' : 'accent'}`}
          >
            {balance.balance.toLocaleString('en-US')}{' '}
            {balance.balance === 1 ? 'email' : 'emails'}
            {balance.lowBalance ? ' — low' : ''}
          </span>
        ) : null}
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <p className="muted-note" role="status">
          {notice}
        </p>
      ) : null}
      {loading ? (
        <Skeleton />
      ) : balance ? (
        <>
          {balance.expiringSoon.length > 0 ? (
            <p className="muted-note">
              Expiring soon:{' '}
              {balance.expiringSoon
                .map(
                  (lot) =>
                    `${lot.emailsRemaining.toLocaleString('en-US')} on ${formatDate(lot.expiresAt)}`,
                )
                .join(', ')}
              .
            </p>
          ) : null}
          {balance.lots.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Total</th>
                    <th>Remaining</th>
                    <th>Expires</th>
                    <th>Granted</th>
                  </tr>
                </thead>
                <tbody>
                  {balance.lots.map((lot) => (
                    <tr key={lot.id}>
                      <td>{lot.source.replace('_', ' ')}</td>
                      <td>{lot.emailsTotal.toLocaleString('en-US')}</td>
                      <td>{lot.emailsRemaining.toLocaleString('en-US')}</td>
                      <td>
                        {lot.expiresAt ? formatDate(lot.expiresAt) : 'Never'}
                      </td>
                      <td>{formatDate(lot.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted-note">No email lots yet.</p>
          )}

          {canTopUp ? (
            <>
              <div className="section-divider" aria-hidden="true" />
              <h3 className="subsection-title">Create a top-up</h3>
              <div className="test-row">
                <label className="inline-field">
                  <span>Amount (৳)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={topUpAmount}
                    onChange={(event) => setTopUpAmount(event.target.value)}
                    placeholder="500"
                    aria-label="Top-up amount"
                  />
                </label>
                <button
                  type="button"
                  className="button button--accent"
                  onClick={() => void createTopUp()}
                  disabled={topUpBusy || previewEmails < 1}
                >
                  {topUpBusy ? 'Creating…' : 'Create top-up invoice'}
                </button>
              </div>
              {topUpAmount.trim() !== '' && Number(topUpAmount) > 0 ? (
                <p className="muted-note">
                  {rate?.pricePerUnit
                    ? `This buys ${previewEmails.toLocaleString('en-US')} emails at the current rate. `
                    : 'No rate is set — top-ups are disabled until the rate is configured in Settings → SaaS SMTP. '}
                  Non-refundable — unused emails are not refunded.
                </p>
              ) : null}
            </>
          ) : null}

          {isSuperadmin ? (
            <>
              <div className="section-divider" aria-hidden="true" />
              <h3 className="subsection-title">Manual adjustment</h3>
              <p className="muted-note">
                Operator error only — for example, refunding emails lost to
                a platform-side send failure. Adjusts the email count, never
                money; there is no refund path.
              </p>
              <div className="domain-config-grid">
                <label className="inline-field">
                  <span>Emails (+ add / − remove)</span>
                  <input
                    type="number"
                    step="1"
                    value={adjustDelta}
                    onChange={(event) => setAdjustDelta(event.target.value)}
                    placeholder="+50 or -20"
                    aria-label="Adjustment in emails"
                  />
                </label>
                <label className="inline-field">
                  <span>Reason (audited)</span>
                  <input
                    value={adjustReason}
                    onChange={(event) => setAdjustReason(event.target.value)}
                    placeholder="Why this adjustment exists"
                    aria-label="Adjustment reason"
                    maxLength={500}
                  />
                </label>
              </div>
              <div className="progress-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => setConfirmAdjust(true)}
                  disabled={
                    adjustBusy ||
                    !adjustDelta.trim() ||
                    !adjustReason.trim()
                  }
                >
                  Adjust balance
                </button>
              </div>
              <ConfirmDialog
                open={confirmAdjust}
                title="Adjust the email balance?"
                body={
                  <>
                    <p>
                      This changes the tenant&apos;s sendable emails by{' '}
                      <strong>
                        {Number(adjustDelta) > 0 ? '+' : ''}
                        {Number(adjustDelta).toLocaleString('en-US')}
                      </strong>{' '}
                      and writes an audited ledger row. The reason is{' '}
                      <strong>{adjustReason.trim()}</strong>.
                    </p>
                  </>
                }
                confirmLabel="Adjust balance"
                busy={adjustBusy}
                onConfirm={() => void applyAdjust()}
                onClose={() => setConfirmAdjust(false)}
              />
            </>
          ) : null}

          {history.length > 0 ? (
            <>
              <div className="section-divider" aria-hidden="true" />
              <h3 className="subsection-title">Recent top-ups</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Emails</th>
                      <th>Paid</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((topUp) => (
                      <tr key={topUp.id}>
                        <td>
                          <Link
                            to="/billing"
                            search={{ tab: 'invoices' }}
                            className="table-link"
                          >
                            {topUp.invoice.number}
                          </Link>
                        </td>
                        <td>
                          {topUp.emailsGranted.toLocaleString('en-US')}
                        </td>
                        <td>{formatMoney(topUp.amountBDT)}</td>
                        <td>{topUp.status}</td>
                        <td>{formatDate(topUp.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {balance.ledger.data.length > 0 ? (
            <>
              <div className="section-divider" aria-hidden="true" />
              <h3 className="subsection-title">Recent ledger</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Kind</th>
                      <th>Change</th>
                      <th>Balance after</th>
                      <th>Note</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balance.ledger.data.slice(0, 10).map((row) => (
                      <tr key={row.id}>
                        <td>{row.kind}</td>
                        <td>
                          {row.delta > 0 ? '+' : ''}
                          {row.delta.toLocaleString('en-US')}
                        </td>
                        <td>{row.balanceAfter.toLocaleString('en-US')}</td>
                        <td>{row.note ?? row.reference ?? '—'}</td>
                        <td>{formatDateTime(row.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
