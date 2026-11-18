import { useState } from 'react';
import { useAuth } from '../../auth';
import { ConfirmDialog } from '../../components/ui';
import { errorMessage, readJson } from '../../lib/api';
import {
  PAYMENT_METHOD_TYPES,
  paymentMethodLabel,
} from '../../lib/settings';
import type { PaymentMethod } from '../../types';
import type { SettingsSectionProps } from './sections';

type MethodConfirm =
  | { kind: 'method-toggle'; method: PaymentMethod }
  | { kind: 'method-delete'; method: PaymentMethod }
  | null;

export function PaymentMethodsSection({
  methods,
  onSaved,
  onError,
}: SettingsSectionProps) {
  const { api } = useAuth();
  const [showMethodForm, setShowMethodForm] = useState(false);
  const [editingMethodId, setEditingMethodId] = useState<string | null>(null);
  const [methodType, setMethodType] = useState('BKASH');
  const [methodName, setMethodName] = useState('');
  const [methodAccountName, setMethodAccountName] = useState('');
  const [methodAccountNumber, setMethodAccountNumber] = useState('');
  const [methodInstructions, setMethodInstructions] = useState('');
  const [methodQrUrl, setMethodQrUrl] = useState('');
  const [methodSortOrder, setMethodSortOrder] = useState('0');
  const [confirm, setConfirm] = useState<MethodConfirm>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function startAddMethod() {
    setEditingMethodId(null);
    setMethodType('BKASH');
    setMethodName('');
    setMethodAccountName('');
    setMethodAccountNumber('');
    setMethodInstructions('');
    setMethodQrUrl('');
    setMethodSortOrder('0');
    setShowMethodForm(true);
  }

  function startEditMethod(method: PaymentMethod) {
    setEditingMethodId(method.id);
    setMethodType(method.type);
    setMethodName(method.name);
    setMethodAccountName(method.accountName ?? '');
    setMethodAccountNumber(method.accountNumber ?? '');
    setMethodInstructions(method.instructions ?? '');
    setMethodQrUrl(method.qrMediaUrl ?? '');
    setMethodSortOrder(String(method.sortOrder));
    setShowMethodForm(true);
  }

  async function saveMethod() {
    if (!methodName.trim()) {
      onError('Give the payment method a name.');
      return;
    }
    setBusy('method');
    onError('');
    try {
      const body = JSON.stringify({
        type: methodType,
        name: methodName.trim(),
        accountName: methodAccountName.trim(),
        accountNumber: methodAccountNumber.trim(),
        instructions: methodInstructions.trim(),
        qrMediaUrl: methodQrUrl.trim(),
        sortOrder: Number(methodSortOrder),
      });
      if (editingMethodId) {
        await api(`/billing/methods/${editingMethodId}`, {
          method: 'PATCH',
          body,
        }).then((r) => readJson(r));
      } else {
        await api('/billing/methods', { method: 'POST', body }).then((r) =>
          readJson(r),
        );
      }
      setShowMethodForm(false);
      setEditingMethodId(null);
      onSaved(
        editingMethodId ? 'Payment method updated.' : 'Payment method added.',
      );
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function toggleMethod(method: PaymentMethod) {
    setBusy(`method-${method.id}`);
    onError('');
    try {
      await api(`/billing/methods/${method.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !method.isActive }),
      }).then((r) => readJson(r));
      onSaved(
        method.isActive
          ? `${method.name} deactivated.`
          : `${method.name} activated.`,
      );
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteMethod(method: PaymentMethod) {
    setBusy(`method-${method.id}`);
    onError('');
    try {
      await api(`/billing/methods/${method.id}`, { method: 'DELETE' }).then(
        (r) => readJson(r),
      );
      onSaved(`${method.name} deleted.`);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Payment methods</h2>
            <p>
              Methods tenants pay with. Deactivate instead of deleting a method
              that proofs or payments already reference.
            </p>
          </div>
          <button
            type="button"
            className="button button--primary"
            onClick={startAddMethod}
            disabled={!!busy}
          >
            Add method
          </button>
        </div>
        {methods.length === 0 ? (
          <p className="muted-note">
            No payment methods yet. Add one to accept manual payments.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Account</th>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {methods.map((method) => (
                  <tr key={method.id}>
                    <td>{paymentMethodLabel(method.type)}</td>
                    <td>{method.name}</td>
                    <td className="mono">
                      {method.accountNumber ?? method.accountName ?? '—'}
                    </td>
                    <td>{method.sortOrder}</td>
                    <td>
                      <span
                        className={`badge badge--${method.isActive ? 'success' : 'muted'}`}
                      >
                        {method.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button button--sm"
                        onClick={() => startEditMethod(method)}
                        disabled={!!busy}
                      >
                        Edit
                      </button>{' '}
                      <button
                        type="button"
                        className="button button--sm button--ghost"
                        onClick={() => setConfirm({ kind: 'method-toggle', method })}
                        disabled={!!busy}
                      >
                        {method.isActive ? 'Deactivate' : 'Activate'}
                      </button>{' '}
                      <button
                        type="button"
                        className="button button--sm button--danger"
                        onClick={() => setConfirm({ kind: 'method-delete', method })}
                        disabled={!!busy}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {showMethodForm ? (
          <div className="domain-config-grid">
            <label className="inline-field">
              <span>Type</span>
              <select
                value={methodType}
                onChange={(event) => setMethodType(event.target.value)}
                aria-label="Payment method type"
              >
                {PAYMENT_METHOD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {paymentMethodLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-field">
              <span>Name</span>
              <input
                value={methodName}
                onChange={(event) => setMethodName(event.target.value)}
                placeholder="bKash Personal"
                aria-label="Payment method name"
              />
            </label>
            <label className="inline-field">
              <span>Account name</span>
              <input
                value={methodAccountName}
                onChange={(event) => setMethodAccountName(event.target.value)}
                placeholder="Optional"
                aria-label="Account name"
              />
            </label>
            <label className="inline-field">
              <span>Account number</span>
              <input
                value={methodAccountNumber}
                onChange={(event) =>
                  setMethodAccountNumber(event.target.value)
                }
                placeholder="Optional"
                aria-label="Account number"
              />
            </label>
            <label className="inline-field">
              <span>Sort order</span>
              <input
                type="number"
                min="0"
                value={methodSortOrder}
                onChange={(event) => setMethodSortOrder(event.target.value)}
                aria-label="Sort order"
              />
            </label>
            <label className="inline-field">
              <span>QR image URL</span>
              <input
                value={methodQrUrl}
                onChange={(event) => setMethodQrUrl(event.target.value)}
                placeholder="Optional"
                aria-label="QR image URL"
              />
            </label>
            <label className="inline-field">
              <span>Payment instructions</span>
              <input
                value={methodInstructions}
                onChange={(event) =>
                  setMethodInstructions(event.target.value)
                }
                placeholder="Shown to tenants at payment time"
                aria-label="Payment instructions"
              />
            </label>
            <div className="progress-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => void saveMethod()}
                disabled={!!busy}
              >
                {busy === 'method'
                  ? 'Saving…'
                  : editingMethodId
                    ? 'Save changes'
                    : 'Add method'}
              </button>{' '}
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setShowMethodForm(false);
                  setEditingMethodId(null);
                }}
                disabled={!!busy}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {confirm ? (
        <ConfirmDialog
          open
          title={
            confirm.kind === 'method-toggle'
              ? confirm.method.isActive
                ? `Deactivate ${confirm.method.name}?`
                : `Activate ${confirm.method.name}?`
              : `Delete ${confirm.method.name}?`
          }
          body={
            confirm.kind === 'method-toggle'
              ? confirm.method.isActive
                ? 'Tenants will no longer see this method when they pay. Existing proofs and payments are unaffected.'
                : 'Tenants will see this method when they pay an invoice.'
              : 'Methods referenced by proofs or payments cannot be deleted — deactivate them instead.'
          }
          confirmLabel={
            confirm.kind === 'method-toggle'
              ? confirm.method.isActive
                ? 'Deactivate'
                : 'Activate'
              : 'Delete method'
          }
          danger={
            confirm.kind === 'method-delete' ||
            (confirm.kind === 'method-toggle' && confirm.method.isActive)
          }
          busy={busy === `method-${confirm.method.id}`}
          onConfirm={async () => {
            const current = confirm;
            setConfirm(null);
            if (current.kind === 'method-toggle')
              await toggleMethod(current.method);
            else await deleteMethod(current.method);
          }}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
}
