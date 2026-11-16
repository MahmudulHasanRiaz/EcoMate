import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import { formatDate, formatDateTime, formatMoney } from '../lib/format';
import type {
  BillingSummary,
  Invoice,
  Page,
  Payment,
  PaymentProof,
} from '../types';
import {
  ErrorNote,
  Loading,
  PageHeader,
  StatusBadge,
} from '../components/ui';

type Tab = 'proofs' | 'invoices' | 'payments';
const PROOF_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
const INVOICE_STATUSES = [
  '',
  'OPEN',
  'PAID',
  'DRAFT',
  'VOID',
  'UNCOLLECTIBLE',
] as const;

export function BillingPage() {
  const { api } = useAuth();
  const [tab, setTab] = useState<Tab>('proofs');
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [proofs, setProofs] = useState<Page<PaymentProof> | null>(null);
  const [invoices, setInvoices] = useState<Page<Invoice> | null>(null);
  const [payments, setPayments] = useState<Page<Payment> | null>(null);
  const [proofStatus, setProofStatus] =
    useState<(typeof PROOF_STATUSES)[number]>('PENDING');
  const [invoiceStatus, setInvoiceStatus] = useState('');
  const [selectedProof, setSelectedProof] = useState<PaymentProof | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const [nextSummary, nextProofs, nextInvoices, nextPayments] =
        await Promise.all([
          api('/billing/summary').then((r) => readJson<BillingSummary>(r)),
          api(`/billing/proofs?status=${proofStatus}&limit=50`).then((r) =>
            readJson<Page<PaymentProof>>(r),
          ),
          api(
            `/billing/invoices?limit=50${invoiceStatus ? `&status=${invoiceStatus}` : ''}`,
          ).then((r) => readJson<Page<Invoice>>(r)),
          api('/billing/payments?limit=50').then((r) =>
            readJson<Page<Payment>>(r),
          ),
        ]);
      setSummary(nextSummary);
      setProofs(nextProofs);
      setInvoices(nextInvoices);
      setPayments(nextPayments);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }, [api, invoiceStatus, proofStatus]);

  useEffect(() => {
    void load();
  }, [load, refresh]);

  async function approveProof(proof: PaymentProof) {
    if (
      !window.confirm(
        `Approve ${formatMoney(proof.amount, proof.invoice?.currency)} for ${proof.tenant?.name}? This records a payment.`,
      )
    ) {
      return;
    }
    setBusy(`approve:${proof.id}`);
    setError(null);
    try {
      const response = await api(`/billing/proofs/${proof.id}/approve`, {
        method: 'POST',
      });
      const result = await readJson<{ invoiceStatus: string }>(response);
      setNotice(
        `Payment recorded. Invoice is now ${result.invoiceStatus}.`,
      );
      setSelectedProof(null);
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function rejectProof(proof: PaymentProof) {
    if (rejectReason.trim().length < 3) {
      setError('Enter a rejection reason (at least 3 characters).');
      return;
    }
    setBusy(`reject:${proof.id}`);
    setError(null);
    try {
      const response = await api(`/billing/proofs/${proof.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      await readJson<unknown>(response);
      setNotice('Payment proof rejected.');
      setSelectedProof(null);
      setRejectReason('');
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function openInvoice(invoice: Invoice) {
    setBusy(`invoice:${invoice.id}`);
    setError(null);
    try {
      const response = await api(`/billing/invoices/${invoice.id}`);
      setSelectedInvoice(await readJson<Invoice>(response));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Billing"
        title="Proofs, invoices and payments"
        description="Review manual transfers, record payments and keep the ledger honest."
      />

      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <div className="notice notice--success" role="status">
          {notice}
        </div>
      ) : null}

      <section className="metric-grid">
        <article className="metric">
          <span>Pending proofs</span>
          <strong>{summary?.pendingProofs ?? '—'}</strong>
          <small>Awaiting review</small>
        </article>
        <article className="metric">
          <span>Open invoices</span>
          <strong>{summary?.openInvoices ?? '—'}</strong>
          <small>Unpaid</small>
        </article>
        <article className="metric">
          <span>Overdue</span>
          <strong>{summary?.overdueInvoices ?? '—'}</strong>
          <small>Past due date</small>
        </article>
        <article className="metric">
          <span>Collected</span>
          <strong>
            {summary ? formatMoney(summary.collectedAmount) : '—'}
          </strong>
          <small>All recorded payments</small>
        </article>
      </section>

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'proofs'}
          className="tab"
          data-active={tab === 'proofs'}
          onClick={() => setTab('proofs')}
        >
          Payment proofs
          {summary ? <span>{summary.pendingProofs}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'invoices'}
          className="tab"
          data-active={tab === 'invoices'}
          onClick={() => setTab('invoices')}
        >
          Invoices
          {summary ? <span>{summary.openInvoices}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'payments'}
          className="tab"
          data-active={tab === 'payments'}
          onClick={() => setTab('payments')}
        >
          Payments
          {payments ? <span>{payments.meta.total}</span> : null}
        </button>
      </div>

      {tab === 'proofs' ? (
        <>
          <div className="toolbar">
            <label className="toolbar-filter">
              <span>Status</span>
              <select
                value={proofStatus}
                onChange={(event) =>
                  setProofStatus(
                    event.target.value as (typeof PROOF_STATUSES)[number],
                  )
                }
              >
                {PROOF_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Proof queue</h2>
                <p>Oldest pending transfer first.</p>
              </div>
            </div>
            {!proofs && busy ? <Loading /> : null}
            {proofs && proofs.data.length === 0 ? (
              <p className="muted-note">No proofs in this state.</p>
            ) : null}
            {proofs && proofs.data.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Submitted</th>
                      <th>Tenant</th>
                      <th>Invoice</th>
                      <th>Method</th>
                      <th>Amount</th>
                      <th>Transaction</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {proofs.data.map((proof) => (
                      <tr key={proof.id}>
                        <td>{formatDate(proof.createdAt)}</td>
                        <td>
                          <strong>{proof.tenant?.name ?? '—'}</strong>
                          <span className="sub">{proof.tenant?.slug}</span>
                        </td>
                        <td className="mono">{proof.invoice?.number ?? '—'}</td>
                        <td>{proof.method?.name ?? '—'}</td>
                        <td>
                          {formatMoney(
                            proof.amount,
                            proof.invoice?.currency || 'BDT',
                          )}
                        </td>
                        <td className="mono">{proof.transactionId}</td>
                        <td>
                          <StatusBadge status={proof.status} />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="button button--ghost"
                            onClick={() => {
                              setSelectedProof(proof);
                              setRejectReason('');
                              setNotice(null);
                            }}
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {selectedProof ? (
        <section className="card review-panel">
          <div className="card-head">
            <div>
              <h2>Review proof</h2>
              <p>
                {selectedProof.tenant?.name} ·{' '}
                {selectedProof.invoice?.number} ·{' '}
                {formatMoney(
                  selectedProof.amount,
                  selectedProof.invoice?.currency || 'BDT',
                )}
              </p>
            </div>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setSelectedProof(null)}
            >
              Close
            </button>
          </div>
          <dl className="facts">
            <div>
              <dt>Method</dt>
              <dd>{selectedProof.method?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>Transaction</dt>
              <dd className="mono">{selectedProof.transactionId}</dd>
            </div>
            <div>
              <dt>Sender</dt>
              <dd>{selectedProof.senderNumber || '—'}</dd>
            </div>
            <div>
              <dt>Note</dt>
              <dd>{selectedProof.note || '—'}</dd>
            </div>
            <div>
              <dt>Screenshot</dt>
              <dd>
                {selectedProof.screenshotUrl ? (
                  <a
                    href={selectedProof.screenshotUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open image
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
          {selectedProof.status === 'PENDING' ? (
            <div className="review-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => approveProof(selectedProof)}
                disabled={!!busy}
              >
                {busy === `approve:${selectedProof.id}`
                  ? 'Approving…'
                  : 'Approve & record payment'}
              </button>
              <div className="reject-box">
                <input
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  placeholder="Rejection reason"
                  aria-label="Rejection reason"
                />
                <button
                  type="button"
                  className="button button--danger"
                  onClick={() => rejectProof(selectedProof)}
                  disabled={!!busy}
                >
                  {busy === `reject:${selectedProof.id}`
                    ? 'Rejecting…'
                    : 'Reject'}
                </button>
              </div>
            </div>
          ) : (
            <p className="muted-note">
              Reviewed {formatDateTime(selectedProof.reviewedAt)}
              {selectedProof.rejectionReason
                ? ` · ${selectedProof.rejectionReason}`
                : ''}
            </p>
          )}
        </section>
      ) : null}

      {tab === 'invoices' ? (
        <>
          <div className="toolbar">
            <label className="toolbar-filter">
              <span>Status</span>
              <select
                value={invoiceStatus}
                onChange={(event) => setInvoiceStatus(event.target.value)}
              >
                {INVOICE_STATUSES.map((status) => (
                  <option key={status || 'all'} value={status}>
                    {status || 'All invoices'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Invoices</h2>
                <p>Subscription invoices and their payment position.</p>
              </div>
            </div>
            {invoices && invoices.data.length === 0 ? (
              <p className="muted-note">No invoices yet.</p>
            ) : null}
            {invoices && invoices.data.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Number</th>
                      <th>Tenant</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Paid</th>
                      <th>Due</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.data.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="mono">{invoice.number}</td>
                        <td>
                          <strong>{invoice.tenant?.name ?? '—'}</strong>
                          <span className="sub">{invoice.tenant?.slug}</span>
                        </td>
                        <td>
                          <StatusBadge status={invoice.status} />
                        </td>
                        <td>{formatMoney(invoice.total, invoice.currency)}</td>
                        <td>{formatMoney(invoice.paidAmount ?? 0, invoice.currency)}</td>
                        <td>{formatDate(invoice.dueAt)}</td>
                        <td>
                          <button
                            type="button"
                            className="button button--ghost"
                            onClick={() => openInvoice(invoice)}
                            disabled={!!busy}
                          >
                            {busy === `invoice:${invoice.id}` ? 'Loading…' : 'Open'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {selectedInvoice ? (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>{selectedInvoice.number}</h2>
              <p>
                {selectedInvoice.tenant?.name} ·{' '}
                <StatusBadge status={selectedInvoice.status} />
              </p>
            </div>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setSelectedInvoice(null)}
            >
              Close
            </button>
          </div>
          <dl className="facts">
            <div>
              <dt>Total</dt>
              <dd>{formatMoney(selectedInvoice.total, selectedInvoice.currency)}</dd>
            </div>
            <div>
              <dt>Paid</dt>
              <dd>
                {formatMoney(
                  selectedInvoice.paidAmount ?? 0,
                  selectedInvoice.currency,
                )}
              </dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd>
                {formatMoney(
                  Number(selectedInvoice.total) -
                    (selectedInvoice.paidAmount ?? 0),
                  selectedInvoice.currency,
                )}
              </dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>{formatDate(selectedInvoice.dueAt)}</dd>
            </div>
            <div>
              <dt>Period</dt>
              <dd>
                {formatDate(selectedInvoice.periodStart)} →{' '}
                {formatDate(selectedInvoice.periodEnd)}
              </dd>
            </div>
          </dl>

          <h3 className="subhead">Lines</h3>
          {(selectedInvoice.lines ?? []).length === 0 ? (
            <p className="muted-note">No invoice lines.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoice.lines?.map((line) => (
                    <tr key={line.id}>
                      <td>{line.description}</td>
                      <td>{line.quantity}</td>
                      <td>{formatMoney(line.unitPrice, selectedInvoice.currency)}</td>
                      <td>{formatMoney(line.amount, selectedInvoice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="subhead">Payments</h3>
          {(selectedInvoice.payments ?? []).length === 0 ? (
            <p className="muted-note">No payments recorded.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoice.payments?.map((payment) => (
                    <tr key={payment.id}>
                      <td>{formatDate(payment.receivedAt)}</td>
                      <td>{payment.method?.name ?? '—'}</td>
                      <td className="mono">{payment.reference || '—'}</td>
                      <td>{formatMoney(payment.amount, selectedInvoice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="subhead">Proofs</h3>
          {(selectedInvoice.proofs ?? []).length === 0 ? (
            <p className="muted-note">No proofs attached.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoice.proofs?.map((proof) => (
                    <tr key={proof.id}>
                      <td className="mono">{proof.transactionId}</td>
                      <td>{proof.method?.name ?? '—'}</td>
                      <td>
                        <StatusBadge status={proof.status} />
                      </td>
                      <td>{formatMoney(proof.amount, selectedInvoice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {tab === 'payments' ? (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Payment ledger</h2>
              <p>Every recorded payment, newest first.</p>
            </div>
          </div>
          {payments && payments.data.length === 0 ? (
            <p className="muted-note">No payments recorded.</p>
          ) : null}
          {payments && payments.data.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Tenant</th>
                    <th>Invoice</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th>Amount</th>
                    <th>Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.data.map((payment) => (
                    <tr key={payment.id}>
                      <td>{formatDate(payment.receivedAt)}</td>
                      <td>
                        <strong>{payment.tenant?.name ?? '—'}</strong>
                        <span className="sub">{payment.tenant?.slug}</span>
                      </td>
                      <td className="mono">{payment.invoice?.number ?? '—'}</td>
                      <td>{payment.method?.name ?? '—'}</td>
                      <td className="mono">{payment.reference || '—'}</td>
                      <td>{formatMoney(payment.amount, payment.currency)}</td>
                      <td className="mono">{payment.recordedBy || 'system'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
