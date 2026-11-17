'use client';

import Link from 'next/link';
import { useCallback, useState, type FormEvent } from 'react';
import {
  slugify,
  validateAccountStep,
  validateSignup,
  validateStoreStep,
  type FieldErrors,
} from '@/lib/signup-validation';
import { Turnstile } from './turnstile';

type Step = 1 | 2 | 3;

interface FormState {
  tenantName: string;
  slug: string;
  ownerEmail: string;
  ownerPhone: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
}

const INITIAL: FormState = {
  tenantName: '',
  slug: '',
  ownerEmail: '',
  ownerPhone: '',
  password: '',
  confirmPassword: '',
  acceptTerms: false,
};

function serverMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  const message = (data as { message?: string | string[] }).message;
  if (Array.isArray(message)) return message.join(' ');
  if (typeof message === 'string' && message.trim()) return message;
  return fallback;
}

export function SignupWizard() {
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [captchaToken, setCaptchaToken] = useState('');
  const [resendToken, setResendToken] = useState('');
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [result, setResult] = useState<{ email: string } | null>(null);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [resendError, setResendError] = useState('');

  const onToken = useCallback((token: string) => setCaptchaToken(token), []);
  const onResendToken = useCallback(
    (token: string) => setResendToken(token),
    [],
  );

  const update = (key: keyof FormState, value: string | boolean) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'tenantName' && !slugTouched) {
        next.slug = slugify(String(value));
      }
      return next;
    });
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const next = () => {
    const nextErrors =
      step === 1
        ? validateStoreStep(form)
        : validateAccountStep(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setServerError('');
    setStep((current) => Math.min(3, current + 1) as Step);
  };

  const back = () => {
    setErrors({});
    setServerError('');
    setStep((current) => Math.max(1, current - 1) as Step);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = validateSignup(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    setServerError('');
    try {
      const response = await fetch('/api/public/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantName: form.tenantName.trim(),
          slug: form.slug.trim().toLowerCase(),
          ownerEmail: form.ownerEmail.trim(),
          ownerPhone: form.ownerPhone.trim() || undefined,
          password: form.password,
          captchaToken: captchaToken || undefined,
          website,
          acceptTerms: true,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setServerError(
          serverMessage(data, 'Signup could not be completed. Please try again.'),
        );
        return;
      }
      setResult({ email: form.ownerEmail.trim().toLowerCase() });
    } catch {
      setServerError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (!result) return;
    setResending(true);
    setResendMessage('');
    setResendError('');
    try {
      const response = await fetch('/api/public/signup/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: result.email,
          captchaToken: resendToken || undefined,
          website: '',
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setResendError(
          serverMessage(data, 'Could not resend the email. Please try again.'),
        );
        return;
      }
      setResendMessage(
        serverMessage(
          data,
          'If a pending signup exists for this email, a new link has been sent.',
        ),
      );
    } catch {
      setResendError('Could not reach the server. Please try again.');
    } finally {
      setResending(false);
    }
  };

  if (result) {
    return (
      <div className="wizard">
        <div className="success-panel">
          <div className="success-mark" aria-hidden>
            ✓
          </div>
          <h2>Check your inbox</h2>
          <p>
            We sent a verification link to <strong>{result.email}</strong>. It
            expires in 24 hours. Open it to finish setting up your store.
          </p>
          <Turnstile onToken={onResendToken} />
          <button
            className="button button--ghost"
            type="button"
            onClick={resend}
            disabled={resending}
          >
            {resending ? 'Sending…' : 'Resend verification email'}
          </button>
          {resendMessage && <p className="hint">{resendMessage}</p>}
          {resendError && (
            <p className="error" role="alert">
              {resendError}
            </p>
          )}
          <p className="center-note">
            Wrong email?{' '}
            <Link className="inline-link" href="/signup">
              Start again
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <form className="wizard" onSubmit={submit} noValidate>
      <div className="stepper" aria-label="Signup progress">
        {(
          [
            [1, 'Store'],
            [2, 'Account'],
            [3, 'Review'],
          ] as const
        ).map(([number, label]) => (
          <span
            className="step-pill"
            data-active={step === number}
            key={number}
          >
            <span aria-hidden>{number}</span>
            {label}
          </span>
        ))}
      </div>

      {serverError && (
        <div className="notice" role="alert">
          {serverError}
        </div>
      )}

      {step === 1 && (
        <>
          <div className="field">
            <label htmlFor="tenantName">Store name</label>
            <input
              id="tenantName"
              className="input"
              value={form.tenantName}
              onChange={(event) => update('tenantName', event.target.value)}
              placeholder="Acme Store"
              autoComplete="organization"
              maxLength={80}
              autoFocus
            />
            {errors.tenantName && (
              <p className="error" role="alert">
                {errors.tenantName}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="slug">Store address</label>
            <input
              id="slug"
              className="input"
              value={form.slug}
              onChange={(event) => {
                setSlugTouched(true);
                update('slug', event.target.value.toLowerCase());
              }}
              placeholder="acme-store"
              autoComplete="off"
              spellCheck={false}
              maxLength={30}
            />
            <p className="hint">
              3–30 lowercase letters, numbers or hyphens. This becomes your
              subdomain; you can connect a custom domain later.
            </p>
            {errors.slug && (
              <p className="error" role="alert">
                {errors.slug}
              </p>
            )}
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="field">
            <label htmlFor="ownerEmail">Owner email</label>
            <input
              id="ownerEmail"
              className="input"
              type="email"
              value={form.ownerEmail}
              onChange={(event) => update('ownerEmail', event.target.value)}
              placeholder="owner@example.com"
              autoComplete="email"
              maxLength={254}
              autoFocus
            />
            {errors.ownerEmail && (
              <p className="error" role="alert">
                {errors.ownerEmail}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="ownerPhone">Phone (optional)</label>
            <input
              id="ownerPhone"
              className="input"
              type="tel"
              value={form.ownerPhone}
              onChange={(event) => update('ownerPhone', event.target.value)}
              placeholder="+880 1700 000000"
              autoComplete="tel"
              maxLength={30}
            />
            {errors.ownerPhone && (
              <p className="error" role="alert">
                {errors.ownerPhone}
              </p>
            )}
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                value={form.password}
                onChange={(event) => update('password', event.target.value)}
                autoComplete="new-password"
                minLength={12}
                maxLength={72}
              />
              {errors.password && (
                <p className="error" role="alert">
                  {errors.password}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="confirmPassword">Confirm password</label>
              <input
                id="confirmPassword"
                className="input"
                type="password"
                value={form.confirmPassword}
                onChange={(event) =>
                  update('confirmPassword', event.target.value)
                }
                autoComplete="new-password"
                minLength={12}
                maxLength={72}
              />
              {errors.confirmPassword && (
                <p className="error" role="alert">
                  {errors.confirmPassword}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div className="summary">
            <dl>
              <dt>Store</dt>
              <dd>{form.tenantName}</dd>
              <dt>Store address</dt>
              <dd>{form.slug}</dd>
              <dt>Owner email</dt>
              <dd>{form.ownerEmail}</dd>
              {form.ownerPhone && (
                <>
                  <dt>Phone</dt>
                  <dd>{form.ownerPhone}</dd>
                </>
              )}
            </dl>
          </div>

          <div className="checkbox-row">
            <input
              id="acceptTerms"
              type="checkbox"
              checked={form.acceptTerms}
              onChange={(event) => update('acceptTerms', event.target.checked)}
            />
            <label htmlFor="acceptTerms">
              I agree to the{' '}
              <a href="/terms" target="_blank" rel="noreferrer">
                terms of service
              </a>{' '}
              and{' '}
              <a href="/privacy" target="_blank" rel="noreferrer">
                privacy policy
              </a>
              , and to receive account email for this workspace.
            </label>
          </div>
          {errors.acceptTerms && (
            <p className="error" role="alert">
              {errors.acceptTerms}
            </p>
          )}

          <div className="hp" aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input
              id="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
            />
          </div>

          <Turnstile onToken={onToken} />
        </>
      )}

      <div className="actions">
        {step > 1 ? (
          <button
            className="button button--ghost"
            type="button"
            onClick={back}
            disabled={submitting}
          >
            Back
          </button>
        ) : (
          <span />
        )}
        {step < 3 ? (
          <button className="button" type="button" onClick={next}>
            Continue
          </button>
        ) : (
          <button className="button" type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create account'}
          </button>
        )}
      </div>
    </form>
  );
}
