'use client';

/**
 * v3 closing: FAQ accordion + lead form.
 *
 * SaaS adaptation: the form posts to the platform's POST /public/leads
 * (same-origin rewrite, `/api/public/leads`) with { name, contact,
 * message?, monthlyOrders?, turnstileToken?, consentGiven, consentText,
 * utmSource?, utmCampaign? }. The consent checkbox is required, so a
 * submitted form always carries the consent text the visitor agreed to;
 * UTM parameters come from the page URL. No Meta Pixel, no CAPI dedup —
 * the platform stores the lead and notifies sales when SMTP is
 * configured. Turnstile is verify-if-present (the SaaS callback-style
 * widget, gated on the site key): the form submits without a token when
 * no widget renders.
 */
import React, { useState } from 'react';
import { useLanding } from '@/components/shell/useLanding';
import { Turnstile } from '@/components/turnstile';
import { SectionHead, SectionShell } from './SectionHead';

export function MkFaq() {
  const { content } = useLanding();
  const faq = content.faq;

  return (
    <SectionShell id="faq">
      <SectionHead
        index="13"
        eyebrow={faq.eyebrow}
        title={faq.heading}
        sub={faq.subheading}
      />
      <div className="mk-pn">
        {faq.items.map((item) => (
          <details key={item.question}>
            <summary>{item.question}</summary>
            <p style={{ color: 'var(--mk-mu)' }}>{item.answer}</p>
          </details>
        ))}
      </div>
    </SectionShell>
  );
}

export function MkLeadForm() {
  const { content, locale } = useLanding();
  const form = content.leadForm;

  const defaultVolume = (options: readonly string[]): string =>
    options[0] ?? form.volumeFallback;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [volume, setVolume] = useState(() => defaultVolume(form.volumeOptions));
  const [message, setMessage] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const required = (message: string): boolean => {
    setFormError(message);
    return false;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      required(locale === 'en' ? 'Please enter your name.' : 'অনুগ্রহ করে আপনার নাম লিখুন।');
      return;
    }
    if (!phone.trim() || phone.trim().length < 8) {
      required(
        locale === 'en'
          ? 'Please enter a valid phone number.'
          : 'অনুগ্রহ করে সঠিক ফোন নম্বর দিন।',
      );
      return;
    }
    if (!consentGiven) {
      required(
        locale === 'en'
          ? 'Please tick the consent box so we are allowed to contact you.'
          : 'যোগাযোগের অনুমতি দিতে অনুগ্রহ করে সম্মতির ঘরটি টিক দিন।',
      );
      return;
    }

    setIsSubmitting(true);
    try {
      // Consent + attribution (Batch 1, item 8): the consent checkbox
      // is required client-side, so a submitted form always carries
      // consentGiven + the consent text the visitor agreed to; UTM
      // parameters come from the page URL (empty = not attributed).
      const params = new URLSearchParams(window.location.search);
      const utmSource = params.get('utm_source') ?? undefined;
      const utmCampaign = params.get('utm_campaign') ?? undefined;
      const response = await fetch('/api/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          contact: phone.trim(),
          ...(message.trim() ? { message: message.trim() } : {}),
          ...(volume ? { monthlyOrders: volume } : {}),
          ...(turnstileToken ? { turnstileToken } : {}),
          consentGiven: true,
          consentText: form.consentLabel,
          ...(utmSource ? { utmSource } : {}),
          ...(utmCampaign ? { utmCampaign } : {}),
        }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const record =
          typeof payload === 'object' && payload !== null
            ? (payload as Record<string, unknown>)
            : null;
        const serverMessage =
          (typeof record?.error === 'string' && record.error) ||
          (typeof record?.message === 'string' && record.message) ||
          (Array.isArray(record?.message) &&
          typeof record.message[0] === 'string'
            ? record.message[0]
            : '');
        throw new Error(
          serverMessage ||
            (locale === 'en'
              ? 'Submission error. Please try again or call directly.'
              : 'অনুরোধটি ব্যর্থ হয়েছে। আবার চেষ্টা করুন বা সরাসরি কল করুন।'),
        );
      }

      setIsSubmitted(true);
    } catch (err: unknown) {
      setFormError(
        err instanceof Error && err.message
          ? err.message
          : locale === 'en'
            ? 'Submission failed. Please call or WhatsApp us directly.'
            : 'অনুরোধটি পাঠানো সম্ভব হয়নি। সরাসরি ফোন বা হোয়াটসঅ্যাপে যোগাযোগ করুন।',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const walkthrough = content.walkthrough;

  return (
    <SectionShell id="demo">
      <SectionHead index="14" eyebrow={form.eyebrow} title={form.heading} sub={form.subheading} />
      <div className="mk-g mk-demo-grid">
        <div className="mk-pn">
          <ul className="mk-check">
            {walkthrough.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          <p className="mk-strip">{walkthrough.trustNote}</p>
        </div>
        <div className="mk-pn">
          {isSubmitted ? (
            <div aria-live="polite">
              <p style={{ fontWeight: 700, fontSize: 17 }}>{form.successHeading}</p>
              <p style={{ color: 'var(--mk-mu)', marginTop: 8 }}>{form.successMessage}</p>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} noValidate={false}>
            <label className="mk-label" htmlFor="mk-lead-name">
              {form.nameLabel}
            </label>
            <input
              id="mk-lead-name"
              className="mk-input"
              type="text"
              autoComplete="name"
              placeholder={form.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <label className="mk-label" htmlFor="mk-lead-phone">
              {form.phoneLabel}
            </label>
            <input
              id="mk-lead-phone"
              className="mk-input"
              type="tel"
              autoComplete="tel"
              placeholder={form.phonePlaceholder}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
            <label className="mk-label" htmlFor="mk-lead-volume">
              {form.volumeLabel}
            </label>
            <select
              id="mk-lead-volume"
              className="mk-input"
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
            >
              {form.volumeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <label className="mk-label" htmlFor="mk-lead-message">
              {form.noteLabel}
            </label>
            <textarea
              id="mk-lead-message"
              className="mk-input"
              rows={3}
              placeholder={form.notePlaceholder}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              style={{ padding: '10px 14px', minHeight: 84, resize: 'vertical' }}
            />
            <label
              style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--mk-mu)', margin: '4px 0 12px', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={consentGiven}
                onChange={(e) => setConsentGiven(e.target.checked)}
                style={{ position: 'static', opacity: 1, pointerEvents: 'auto', marginTop: 3 }}
              />
              {form.consentLabel}
            </label>
            <Turnstile onToken={setTurnstileToken} />
            {formError && (
              <p role="alert" style={{ color: 'var(--mk-bad)', fontSize: 13, margin: '0 0 10px' }}>
                {formError}
              </p>
            )}
            <button type="submit" className="mk-btn mk-btn-primary mk-btn-block" disabled={isSubmitting}>
              {isSubmitting ? form.submittingText : form.submitCta}
            </button>
            <p className="mk-strip">{form.privacyNote}</p>
          </form>
          )}
        </div>
      </div>
    </SectionShell>
  );
}
