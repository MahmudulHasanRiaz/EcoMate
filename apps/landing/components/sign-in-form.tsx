'use client';

import { useState } from 'react';
import { tenantAdminSignInUrl } from '@/lib/branding';
import { SLUG_PATTERN } from '@/lib/signup-validation';

/**
 * Returning-owner sign-in: the tenant admin lives at
 * https://<slug>.<primary-domain>/admin/sign-in, and the landing does not
 * know the visitor's slug — so ask for it and redirect. The slug is
 * validated client-side (server validates again by resolving the host);
 * nothing is submitted to the landing itself.
 */
export function SignInForm() {
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = slug.trim().toLowerCase();
    if (!SLUG_PATTERN.test(clean)) {
      setError(
        'Enter your store address: 3–30 lowercase letters, numbers or hyphens.',
      );
      return;
    }
    const url = tenantAdminSignInUrl(clean);
    if (!url) {
      setError('That store address does not look right. Check it and try again.');
      return;
    }
    window.location.href = url;
  };

  return (
    <form className="wizard signin-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="signin-slug">Store address</label>
        <div className="slug-input">
          <input
            id="signin-slug"
            className="input"
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value);
              setError('');
            }}
            placeholder="your-store"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <span className="slug-suffix" aria-hidden>
            .{process.env.NEXT_PUBLIC_PRIMARY_DOMAIN || 'ecomate.bd'}
          </span>
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <button className="button button--wide" type="submit">
        Continue to sign in
      </button>
      <p className="fine-print">
        You will be taken to your store&apos;s own sign-in page. We never see
        your password here.
      </p>
    </form>
  );
}
