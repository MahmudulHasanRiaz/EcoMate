import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import {
  AlarmClock,
  Banknote,
  FileCheck,
  Receipt,
} from 'lucide-react';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import { formatDate, formatDateTime, formatMoney, formatStatus } from '../lib/format';
import type {
  BillingSummary,
  Coupon,
  CreditNote,
  Invoice,
  JobsStatus,
  Page,
  Payment,
  PaymentMethod,
  PaymentProof,
  Plan,
  Subscription,
  Tenant,
} from '../types';
import {
  ConfirmDialog,
  ErrorNote,
  PageHeader,
  ScrollableTabs,
  Skeleton,
  StatusBadge,
} from '../components/ui';

type Tab =
  | 'proofs'
  | 'invoices'
  | 'payments'
  | 'subscriptions'
  | 'credits'
  | 'coupons'
  | 'methods'
  | 'jobs';
const TABS: Tab[] = [
  'proofs',
  'invoices',
  'payments',
  'subscriptions',
  'credits',
  'coupons',
  'methods',
  'jobs',
];

/** Tab from the parsed ?tab= param (global search deep-links here). */
function tabFromParam(param: unknown): Tab {
  return typeof param === 'string' && (TABS as string[]).includes(param)
    ? (param as Tab)
    : 'proofs';
}

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
  const location = useLocation();
  const tabParam = (location.search as { tab?: unknown }).tab;
  const [tab, setTab] = useState<Tab>(() => tabFromParam(tabParam));

  // The page does not remount when search navigation lands on a different
  // ?tab= while already on /billing — sync the tab to the URL instead.
  useEffect(() => {
    setTab(tabFromParam(tabParam));
  }, [tabParam]);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [proofs, setProofs] = useState<Page<PaymentProof> | null>(null);
  const [invoices, setInvoices] = useState<Page<Invoice> | null>(null);
  const [payments, setPayments] = useState<Page<Payment> | null>(null);
  const [subscriptions, setSubscriptions] =
    useState<Page<Subscription> | null>(null);
  const [creditNotes, setCreditNotes] = useState<Page<CreditNote> | null>(null);
  const [coupons, setCoupons] = useState<Page<Coupon> | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tenants, setTenants] = useState<Page<Tenant> | null>(null);
  const [jobs, setJobs] = useState<JobsStatus | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [confirmApprove, setConfirmApprove] = useState<PaymentProof | null>(null);
  const [confirmCoupon, setConfirmCoupon] = useState<Coupon | null>(null);
  const [invoiceTenantId, setInvoiceTenantId] = useState('');
  const [invoiceDescription, setInvoiceDescription] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceDueAt, setInvoiceDueAt] = useState('');
  const [planChoices, setPlanChoices] = useState<Record<string, string>>({});
  const [proofStatus, setProofStatus] =
    useState<(typeof PROOF_STATUSES)[number]>('PENDING');
  const [invoiceStatus, setInvoiceStatus] = useState('');
  const [selectedProof, setSelectedProof] = useState<PaymentProof | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [couponType, setCouponType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [couponValue, setCouponValue] = useState('');
  const [couponDuration, setCouponDuration] =
    useState<'ONCE' | 'FOREVER' | 'MONTHS'>('ONCE');
  const [couponMonths, setCouponMonths] = useState('1');
  const [couponMax, setCouponMax] = useState('');
  const [couponExpires, setCouponExpires] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const [nextSummary, nextProofs, nextInvoices, nextPayments, nextSubscriptions, nextCredits, nextCoupons, nextPlans, nextTenants, nextJobs, nextMethods] =
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
          api('/billing/subscriptions?limit=50').then((r) =>
            readJson<Page<Subscription>>(r),
          ),
          api('/billing/credit-notes?limit=50').then((r) =>
            readJson<Page<CreditNote>>(r),
          ),
          api('/billing/coupons?limit=50').then((r) =>
            readJson<Page<Coupon>>(r),
          ),
          api('/plans').then((r) => readJson<Plan[]>(r)),
          api('/tenants?limit=100').then((r) => readJson<Page<Tenant>>(r)),
          api('/jobs').then((r) => readJson<JobsStatus>(r)),
          api('/billing/methods').then((r) => readJson<PaymentMethod[]>(r)),
        ]);
      setSummary(nextSummary);
      setProofs(nextProofs);
      setInvoices(nextInvoices);
      setPayments(nextPayments);
      setSubscriptions(nextSubscriptions);
      setCreditNotes(nextCredits);
      setCoupons(nextCoupons);
      setPlans(nextPlans);
      setTenants(nextTenants);
      setJobs(nextJobs);
      setMethods(nextMethods);
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

  async function downloadInvoicePdf(invoice: Invoice) {
    setBusy(`pdf:${invoice.id}`);
    setError(null);
    try {
      const response = await api(`/billing/invoices/${invoice.id}/pdf`);
      if (!response.ok) {
        throw new Error(`Invoice PDF failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `invoice-${invoice.number}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(`Invoice ${invoice.number} downloaded as PDF.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function createInvoice() {
    if (!invoiceTenantId || !invoiceDescription.trim() || !invoiceAmount) {
      setError('Pick a tenant, a description and an amount first.');
      return;
    }
    setBusy('create-invoice');
    setError(null);
    setNotice(null);
    try {
      const response = await api('/billing/invoices', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: invoiceTenantId,
          lines: [
            {
              description: invoiceDescription.trim(),
              quantity: 1,
              unitPrice: Number(invoiceAmount),
            },
          ],
          dueAt: invoiceDueAt ? new Date(invoiceDueAt).toISOString() : undefined,
        }),
      });
      const created = await readJson<Invoice>(response);
      setNotice(`Invoice ${created.number} created.`);
      setInvoiceDescription('');
      setInvoiceAmount('');
      setInvoiceDueAt('');
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function runJob(name: string) {
    setBusy(`job:${name}`);
    setError(null);
    setNotice(null);
    try {
      const response = await api(`/jobs/${name}/run`, { method: 'POST' });
      const result = await readJson<{
        counts: Record<string, number>;
        errors: string[];
      }>(response);
      const counts = Object.entries(result.counts)
        .map(([key, value]) => `${key} ${value}`)
        .join(', ');
      setNotice(
        `Job ${name} finished${counts ? `: ${counts}` : ''}${result.errors.length > 0 ? ` — ${result.errors.length} error(s)` : ''}.`,
      );
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function runAllJobs() {
    setBusy('job:all');
    setError(null);
    setNotice(null);
    try {
      const response = await api('/jobs/all/run', { method: 'POST' });
      await readJson(response);
      setNotice('All billing jobs finished.');
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const planOptions = plans
    .flatMap((plan) =>
      plan.versions
        .filter((version) => !version.archivedAt)
        .map((version) => ({ planName: plan.name, version })),
    )
    .sort((a, b) =>
      `${a.planName} v${a.version.version}`.localeCompare(
        `${b.planName} v${b.version.version}`,
      ),
    );

  async function changeSubscriptionPlan(subscription: Subscription) {
    const planVersionId =
      planChoices[subscription.id] ?? subscription.planVersionId;
    if (planVersionId === subscription.planVersionId) {
      setError('Choose a different plan version first.');
      return;
    }
    setBusy(`plan:${subscription.id}`);
    setError(null);
    try {
      const response = await api(
        `/tenants/${subscription.tenantId}/change-plan`,
        {
          method: 'POST',
          body: JSON.stringify({ planVersionId }),
        },
      );
      await readJson<unknown>(response);
      setNotice('Subscription plan changed and entitlement snapshot refreshed.');
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function issueCreditNote() {
    if (!selectedInvoice) return;
    const amount = Number(creditAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a credit amount greater than zero.');
      return;
    }
    if (creditReason.trim().length < 3) {
      setError('Enter a credit note reason.');
      return;
    }
    setBusy('credit');
    setError(null);
    try {
      const response = await api('/billing/credit-notes', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: selectedInvoice.tenantId,
          appliedInvoiceId: selectedInvoice.id,
          amount,
          currency: selectedInvoice.currency,
          reason: creditReason.trim(),
        }),
      });
      await readJson<unknown>(response);
      setNotice('Credit note issued.');
      setCreditAmount('');
      setCreditReason('');
      await openInvoice(selectedInvoice);
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function createCoupon() {
    const value = Number(couponValue);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Coupon value must be greater than zero.');
      return;
    }
    setBusy('coupon:create');
    setError(null);
    try {
      const response = await api('/billing/coupons', {
        method: 'POST',
        body: JSON.stringify({
          code: couponCode.trim(),
          type: couponType,
          value,
          duration: couponDuration,
          durationMonths:
            couponDuration === 'MONTHS' ? Number(couponMonths) : undefined,
          maxRedemptions: couponMax ? Number(couponMax) : undefined,
          expiresAt: couponExpires
            ? new Date(`${couponExpires}T23:59:59`).toISOString()
            : undefined,
        }),
      });
      const created = await readJson<Coupon>(response);
      setNotice(`Coupon ${created.code} created.`);
      setCouponCode('');
      setCouponValue('');
      setCouponMax('');
      setCouponExpires('');
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function toggleCoupon(coupon: Coupon) {
    setBusy(`coupon:${coupon.id}`);
    setError(null);
    try {
      const response = await api(`/billing/coupons/${coupon.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !coupon.isActive }),
      });
      await readJson<unknown>(response);
      setNotice(coupon.isActive ? 'Coupon disabled.' : 'Coupon enabled.');
      setRefresh((value) => value + 1);
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
        <article className="metric metric--tint-1">
          <span className="metric-icon" aria-hidden="true">
            <FileCheck size={16} strokeWidth={2} />
          </span>
          <span>Pending proofs</span>
          <strong>{summary?.pendingProofs ?? '—'}</strong>
          <small>Awaiting review</small>
        </article>
        <article className="metric metric--tint-2">
          <span className="metric-icon" aria-hidden="true">
            <Receipt size={16} strokeWidth={2} />
          </span>
          <span>Open invoices</span>
          <strong>{summary?.openInvoices ?? '—'}</strong>
          <small>Unpaid</small>
        </article>
        <article className="metric metric--tint-3">
          <span className="metric-icon" aria-hidden="true">
            <AlarmClock size={16} strokeWidth={2} />
          </span>
          <span>Overdue</span>
          <strong>{summary?.overdueInvoices ?? '—'}</strong>
          <small>Past due date</small>
        </article>
        <article className="metric metric--tint-4">
          <span className="metric-icon" aria-hidden="true">
            <Banknote size={16} strokeWidth={2} />
          </span>
          <span>Collected</span>
          <strong>
            {summary ? formatMoney(summary.collectedAmount) : '—'}
          </strong>
          <small>All recorded payments</small>
        </article>
      </section>

      <ScrollableTabs label="Billing sections">
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
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'subscriptions'}
          className="tab"
          data-active={tab === 'subscriptions'}
          onClick={() => setTab('subscriptions')}
        >
          Subscriptions
          {subscriptions ? <span>{subscriptions.meta.total}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'credits'}
          className="tab"
          data-active={tab === 'credits'}
          onClick={() => setTab('credits')}
        >
          Credit notes
          {creditNotes ? <span>{creditNotes.meta.total}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'coupons'}
          className="tab"
          data-active={tab === 'coupons'}
          onClick={() => setTab('coupons')}
        >
          Coupons
          {coupons ? <span>{coupons.meta.total}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'methods'}
          className="tab"
          data-active={tab === 'methods'}
          onClick={() => setTab('methods')}
        >
          Payment methods
          <span>{methods.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'jobs'}
          className="tab"
          data-active={tab === 'jobs'}
          onClick={() => setTab('jobs')}
        >
          Billing jobs
        </button>
      </ScrollableTabs>

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
                    {formatStatus(status)}
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
            {!proofs && busy ? <Skeleton /> : null}
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
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {proofs.data.map((proof) => (
                      <tr key={proof.id}>
                        <td>{formatDate(proof.createdAt)}</td>
                        <td>
                          {proof.tenant ? (
                            <Link
                              to="/tenants/$tenantId"
                              params={{ tenantId: proof.tenant.id }}
                              className="table-link"
                            >
                              {proof.tenant.name}
                            </Link>
                          ) : (
                            '—'
                          )}
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
                className="button button--accent"
                onClick={() => setConfirmApprove(selectedProof)}
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
                    {status ? formatStatus(status) : 'All invoices'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Create invoice</h2>
                <p>
                  A manual invoice for a tenant. Open credit applies
                  automatically; a fully-covered invoice is marked paid.
                </p>
              </div>
            </div>
            {(tenants?.data ?? []).length === 0 ? (
              <p className="muted-note">
                No tenants exist yet.{' '}
                <Link to="/tenants/new">Create a tenant first</Link> — an
                invoice needs a tenant to bill.
              </p>
            ) : (
              <div className="form-row">
                <label className="inline-field">
                  <span>Tenant</span>
                <select
                  value={invoiceTenantId}
                  onChange={(event) => setInvoiceTenantId(event.target.value)}
                  aria-label="Invoice tenant"
                >
                  <option value="">Select a tenant</option>
                  {(tenants?.data ?? []).map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name} ({tenant.slug})
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-field">
                <span>Description</span>
                <input
                  type="text"
                  value={invoiceDescription}
                  onChange={(event) => setInvoiceDescription(event.target.value)}
                  placeholder="e.g. Setup fee"
                  aria-label="Invoice description"
                />
              </label>
              <label className="inline-field">
                <span>Amount (BDT)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={invoiceAmount}
                  onChange={(event) => setInvoiceAmount(event.target.value)}
                  aria-label="Invoice amount"
                />
              </label>
              <label className="inline-field">
                <span>Due date</span>
                <input
                  type="date"
                  value={invoiceDueAt}
                  onChange={(event) => setInvoiceDueAt(event.target.value)}
                  aria-label="Invoice due date"
                />
              </label>
              <button
                type="button"
                className="button button--accent"
                onClick={() => void createInvoice()}
                disabled={!!busy}
              >
                  {busy === 'create-invoice' ? 'Creating…' : 'Create invoice'}
                </button>
              </div>
            )}
          </section>
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
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.data.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="mono">{invoice.number}</td>
                        <td>
                          {invoice.tenant ? (
                            <Link
                              to="/tenants/$tenantId"
                              params={{ tenantId: invoice.tenant.id }}
                              className="table-link"
                            >
                              {invoice.tenant.name}
                            </Link>
                          ) : (
                            '—'
                          )}
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
            <div className="button-row">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => void downloadInvoicePdf(selectedInvoice)}
                disabled={!!busy}
              >
                {busy === `pdf:${selectedInvoice.id}`
                  ? 'Preparing…'
                  : 'Download PDF'}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setSelectedInvoice(null)}
              >
                Close
              </button>
            </div>
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
              <dt>Credit applied</dt>
              <dd>
                {formatMoney(
                  selectedInvoice.creditAmount ?? 0,
                  selectedInvoice.currency,
                )}
              </dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd>
                {formatMoney(
                  selectedInvoice.remaining ??
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
          <h3 className="subhead">Credit notes</h3>
          {(selectedInvoice.creditNotes ?? []).length === 0 ? (
            <p className="muted-note">No credit notes on this invoice.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Reason</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoice.creditNotes?.map((note) => (
                    <tr key={note.id}>
                      <td>{formatDate(note.createdAt)}</td>
                      <td>{note.reason}</td>
                      <td>{formatMoney(note.amount, note.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="credit-form">
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Amount"
              aria-label="Credit amount"
              value={creditAmount}
              onChange={(event) => setCreditAmount(event.target.value)}
            />
            <input
              placeholder="Reason"
              aria-label="Credit reason"
              value={creditReason}
              onChange={(event) => setCreditReason(event.target.value)}
            />
            <button
              type="button"
              className="button"
              onClick={issueCreditNote}
              disabled={!!busy}
            >
              {busy === 'credit' ? 'Issuing…' : 'Issue credit note'}
            </button>
          </div>
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
                        {payment.tenant ? (
                          <Link
                            to="/tenants/$tenantId"
                            params={{ tenantId: payment.tenant.id }}
                            className="table-link"
                          >
                            {payment.tenant.name}
                          </Link>
                        ) : (
                          '—'
                        )}
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

      {tab === 'subscriptions' ? (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Subscriptions</h2>
              <p>Plan versions, billing periods and add-ons.</p>
            </div>
          </div>
          {subscriptions && subscriptions.data.length === 0 ? (
            <p className="muted-note">No subscriptions yet.</p>
          ) : null}
          {subscriptions && subscriptions.data.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Status</th>
                    <th>Current plan</th>
                    <th>Period ends</th>
                    <th>Add-ons</th>
                    <th>Change plan</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.data.map((subscription) => (
                    <tr key={subscription.id}>
                      <td>
                        {subscription.tenant ? (
                          <Link
                            to="/tenants/$tenantId"
                            params={{ tenantId: subscription.tenant.id }}
                            className="table-link"
                          >
                            {subscription.tenant.name}
                          </Link>
                        ) : (
                          '—'
                        )}
                        <span className="sub">{subscription.tenant?.slug}</span>
                      </td>
                      <td>
                        <StatusBadge status={subscription.status} />
                      </td>
                      <td>
                        {subscription.planVersion
                          ? `${subscription.planVersion.plan?.name ?? 'Plan'} v${subscription.planVersion.version}`
                          : '—'}
                      </td>
                      <td>{formatDate(subscription.currentPeriodEnd)}</td>
                      <td>
                        {subscription.addOns?.length
                          ? subscription.addOns
                              .map((addOn) => addOn.addOn?.name ?? addOn.addOnId)
                              .join(', ')
                          : '—'}
                      </td>
                      <td>
                        <div className="row-action">
                          <select
                            value={
                              planChoices[subscription.id] ??
                              subscription.planVersionId
                            }
                            onChange={(event) =>
                              setPlanChoices((previous) => ({
                                ...previous,
                                [subscription.id]: event.target.value,
                              }))
                            }
                            aria-label={`Plan for ${subscription.tenant?.name ?? subscription.tenantId}`}
                          >
                            {planOptions.map((option) => (
                              <option
                                key={option.version.id}
                                value={option.version.id}
                              >
                                {option.planName} v{option.version.version}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="button button--ghost"
                            onClick={() => changeSubscriptionPlan(subscription)}
                            disabled={!!busy}
                          >
                            {busy === `plan:${subscription.id}`
                              ? 'Changing…'
                              : 'Change'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'credits' ? (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Credit notes</h2>
              <p>Credits issued against tenant invoices.</p>
            </div>
          </div>
          {creditNotes && creditNotes.data.length === 0 ? (
            <p className="muted-note">
              No credit notes yet. Issue one from an invoice detail.
            </p>
          ) : null}
          {creditNotes && creditNotes.data.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Tenant</th>
                    <th>Invoice</th>
                    <th>Reason</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {creditNotes.data.map((note) => (
                    <tr key={note.id}>
                      <td>{formatDate(note.createdAt)}</td>
                      <td>
                        {note.tenant ? (
                          <Link
                            to="/tenants/$tenantId"
                            params={{ tenantId: note.tenant.id }}
                            className="table-link"
                          >
                            {note.tenant.name}
                          </Link>
                        ) : (
                          '—'
                        )}
                        <span className="sub">{note.tenant?.slug}</span>
                      </td>
                      <td className="mono">
                        {note.appliedInvoice?.number ?? '—'}
                      </td>
                      <td>{note.reason}</td>
                      <td>{formatMoney(note.amount, note.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'coupons' ? (
        <>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>New coupon</h2>
                <p>Codes are stored uppercase and can be plan-scoped later.</p>
              </div>
            </div>
            <div className="coupon-form">
              <label className="inline-field">
                <span>Code</span>
                <input
                  value={couponCode}
                  onChange={(event) => setCouponCode(event.target.value)}
                  placeholder="SAVE10"
                  aria-label="Coupon code"
                />
              </label>
              <label className="inline-field">
                <span>Type</span>
                <select
                  value={couponType}
                  onChange={(event) =>
                    setCouponType(event.target.value as 'PERCENT' | 'FIXED')
                  }
                  aria-label="Coupon type"
                >
                  <option value="PERCENT">Percent</option>
                  <option value="FIXED">Fixed</option>
                </select>
              </label>
              <label className="inline-field">
                <span>Value</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={couponValue}
                  onChange={(event) => setCouponValue(event.target.value)}
                  aria-label="Coupon value"
                />
              </label>
              <label className="inline-field">
                <span>Duration</span>
                <select
                  value={couponDuration}
                  onChange={(event) =>
                    setCouponDuration(
                      event.target.value as 'ONCE' | 'FOREVER' | 'MONTHS',
                    )
                  }
                  aria-label="Coupon duration"
                >
                  <option value="ONCE">Once</option>
                  <option value="FOREVER">Forever</option>
                  <option value="MONTHS">Months</option>
                </select>
              </label>
              {couponDuration === 'MONTHS' ? (
                <label className="inline-field">
                  <span>Months</span>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={couponMonths}
                    onChange={(event) => setCouponMonths(event.target.value)}
                    aria-label="Duration months"
                  />
                </label>
              ) : null}
              <label className="inline-field">
                <span>Max uses</span>
                <input
                  type="number"
                  min="1"
                  value={couponMax}
                  onChange={(event) => setCouponMax(event.target.value)}
                  placeholder="Unlimited"
                  aria-label="Max redemptions"
                />
              </label>
              <label className="inline-field">
                <span>Expires</span>
                <input
                  type="date"
                  value={couponExpires}
                  onChange={(event) => setCouponExpires(event.target.value)}
                  aria-label="Coupon expiry"
                />
              </label>
              <button
                type="button"
                className="button button--accent"
                onClick={createCoupon}
                disabled={!!busy}
              >
                {busy === 'coupon:create' ? 'Creating…' : 'Create coupon'}
              </button>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2>Coupons</h2>
                <p>Active and retired discount codes.</p>
              </div>
            </div>
            {coupons && coupons.data.length === 0 ? (
              <p className="muted-note">No coupons yet.</p>
            ) : null}
            {coupons && coupons.data.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Discount</th>
                      <th>Duration</th>
                      <th>Redeemed</th>
                      <th>Expires</th>
                      <th>Status</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {coupons.data.map((coupon) => (
                      <tr key={coupon.id}>
                        <td className="mono">{coupon.code}</td>
                        <td>
                          {coupon.type === 'PERCENT'
                            ? `${coupon.value}%`
                            : formatMoney(coupon.value)}
                        </td>
                        <td>
                          {coupon.duration === 'MONTHS'
                            ? `${coupon.durationMonths} months`
                            : coupon.duration.toLowerCase()}
                        </td>
                        <td>
                          {coupon.redeemedCount}
                          {coupon.maxRedemptions
                            ? ` / ${coupon.maxRedemptions}`
                            : ''}
                        </td>
                        <td>{formatDate(coupon.expiresAt)}</td>
                        <td>
                          <span
                            className={`badge ${
                              coupon.isActive
                                ? 'badge--accent'
                                : 'badge--muted'
                            }`}
                          >
                            {coupon.isActive ? 'Active' : 'Disabled'}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="button button--ghost"
                            onClick={() => setConfirmCoupon(coupon)}
                            disabled={!!busy}
                          >
                            {busy === `coupon:${coupon.id}`
                              ? 'Updating…'
                              : coupon.isActive
                                ? 'Disable'
                                : 'Enable'}
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

      {tab === 'jobs' ? (
        <>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Billing jobs</h2>
                <p>
                  The lifecycle runs on a schedule (hourly by default). Each
                  job is idempotent — running it twice changes nothing the
                  second time.
                </p>
              </div>
              <button
                type="button"
                className="button"
                onClick={() => void runAllJobs()}
                disabled={!!busy}
              >
                {busy === 'job:all' ? 'Running…' : 'Run all jobs'}
              </button>
            </div>
            {!jobs ? (
              <p className="muted-note">Loading job status…</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Last run</th>
                      <th>Last result</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.jobs.map((job) => (
                      <tr key={job.name}>
                        <td className="mono">{job.name}</td>
                        <td>
                          {job.lastRunAt
                            ? formatDateTime(job.lastRunAt)
                            : 'Never'}
                        </td>
                        <td>
                          {job.lastResult
                            ? Object.entries(job.lastResult.counts)
                                .map(([key, value]) => `${key} ${value}`)
                                .join(', ') || 'No changes'
                            : '—'}
                          {job.lastError ? (
                            <span className="sub error-text">
                              {job.lastError}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="button button--ghost"
                            onClick={() => void runJob(job.name)}
                            disabled={!!busy}
                          >
                            {busy === `job:${job.name}` ? 'Running…' : 'Run'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      {tab === 'methods' ? (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Payment methods</h2>
              <p>
                The manual payment methods tenants see when they pay an
                invoice. Methods are managed in Settings.
              </p>
            </div>
            <Link to="/settings" className="button">
              Manage in Settings
            </Link>
          </div>
          {methods.length === 0 ? (
            <p className="muted-note">
              No payment methods configured yet. Add one in Settings so
              tenants can pay manually.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Account</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {methods.map((method) => (
                    <tr key={method.id}>
                      <td>{method.name}</td>
                      <td>{method.type}</td>
                      <td>
                        {method.accountNumber || '—'}
                        {method.accountName ? (
                          <span className="sub">{method.accountName}</span>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className={`badge ${method.isActive ? 'badge--accent' : 'badge--neutral'}`}
                        >
                          {method.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {confirmApprove ? (
        <ConfirmDialog
          open
          title="Approve payment proof"
          body={`Approve ${formatMoney(confirmApprove.amount, confirmApprove.invoice?.currency)} for ${confirmApprove.tenant?.name}? This records a payment against invoice ${confirmApprove.invoice?.number}.`}
          confirmLabel="Approve and record payment"
          busy={busy === `approve:${confirmApprove.id}`}
          onConfirm={async () => {
            const proof = confirmApprove;
            setConfirmApprove(null);
            await approveProof(proof);
          }}
          onClose={() => setConfirmApprove(null)}
        />
      ) : null}

      {confirmCoupon ? (
        <ConfirmDialog
          open
          title={confirmCoupon.isActive ? 'Disable coupon' : 'Enable coupon'}
          body={
            confirmCoupon.isActive
              ? `Disable coupon ${confirmCoupon.code}? Tenants will no longer be able to redeem it.`
              : `Enable coupon ${confirmCoupon.code}? Tenants will be able to redeem it again.`
          }
          confirmLabel={confirmCoupon.isActive ? 'Disable coupon' : 'Enable coupon'}
          danger={confirmCoupon.isActive}
          busy={busy === `coupon:${confirmCoupon.id}`}
          onConfirm={async () => {
            const coupon = confirmCoupon;
            setConfirmCoupon(null);
            await toggleCoupon(coupon);
          }}
          onClose={() => setConfirmCoupon(null)}
        />
      ) : null}
    </>
  );
}
