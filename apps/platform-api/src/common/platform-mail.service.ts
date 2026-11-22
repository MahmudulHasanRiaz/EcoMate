import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { SettingsService, splitFrom } from '../settings/settings.service';
import {
  escapeHtml,
  link,
  para,
  renderDetails,
  renderEmailLayout,
  type EmailBrand,
} from './mail/email-layout';

const DHAKA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function formatDhakaDate(value: Date | string): string {
  return DHAKA_DATE.format(new Date(value));
}

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Plain-language cause for the mail transport failures operators hit
 * most often. Nodemailer reports these as bare codes (EAUTH,
 * ECONNREFUSED, EPROTO, ...) with a terse message; the hint names the
 * cause at a glance and the raw detail follows it. The classic case is
 * implicit TLS switched on against a STARTTLS port (587): nodemailer
 * fails the handshake with EPROTO "wrong version number".
 */
function smtpErrorHint(code: unknown, message: string): string | null {
  const c = typeof code === 'string' ? code : '';
  const m = message.toLowerCase();
  if (
    c === 'EAUTH' ||
    /invalid login|authentication failed|\b535\b|\b530\b/.test(m)
  ) {
    return 'SMTP authentication failed';
  }
  if (
    c === 'ECONNREFUSED' ||
    c === 'ECONNECTION' ||
    /econnrefused|connection refused/.test(m)
  ) {
    return 'Could not connect to the SMTP server';
  }
  if (c === 'ETIMEDOUT' || c === 'ESOCKETTIMEOUT' || /timed out/.test(m)) {
    return 'Connection to the SMTP server timed out';
  }
  if (c === 'ENOTFOUND' || /enotfound|getaddrinfo|dns lookup/.test(m)) {
    return 'SMTP host could not be resolved';
  }
  if (
    /certificate|self signed|unable to verify the first certificate/.test(m)
  ) {
    return 'TLS certificate problem';
  }
  if (
    c === 'EPROTO' ||
    /wrong version number|handshake failure|ssl routines|\btls\b/.test(m)
  ) {
    return 'TLS handshake failed';
  }
  return null;
}

/**
 * Turn a raw mail transport error into a message that is safe to show
 * the operator. Host/port/auth-failure wording is the operator's own
 * config, so it stays; anything credential-shaped is redacted, and the
 * result is capped so a long SMTP transcript cannot flood the inline
 * error note. Never returns an empty string.
 */
export function sanitizeMailErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const code = (error as { code?: unknown } | null)?.code;
  const redacted = raw
    .trim()
    .replace(
      /(password|passwd|pwd|pass|secret|token)\s*[:=]\s*\S+/gi,
      '$1: [redacted]',
    )
    .replace(/\/\/[^/\s:]+:[^/\s@]+@/g, '//[redacted]@')
    .replace(/(authorization:\s*)\S+/gi, '$1[redacted]');
  const hint = smtpErrorHint(code, redacted);
  const combined = hint ? `${hint}: ${redacted}` : redacted;
  const trimmed = combined.slice(0, 300).trim();
  return trimmed || 'Sending the test email failed.';
}

@Injectable()
export class PlatformMailService {
  private readonly logger = new Logger(PlatformMailService.name);
  /** undefined = not built yet; null = SMTP unconfigured. */
  private transporter: Transporter | null | undefined = undefined;

  constructor(private readonly settings: SettingsService) {}

  /**
   * Drop the cached transporter so the next send rebuilds it from the
   * current effective SMTP config. Called after SMTP settings change.
   */
  refresh(): void {
    if (this.transporter) {
      try {
        this.transporter.close();
      } catch {
        // Best-effort: a stale transporter must never break the settings save.
      }
    }
    this.transporter = undefined;
  }

  isConfigured(): boolean {
    return this.settings.getSmtp() !== null;
  }

  private getTransporter(): Transporter | null {
    if (this.transporter !== undefined) return this.transporter;
    const config = this.settings.getSmtp();
    if (!config) {
      this.transporter = null;
      return null;
    }
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user
        ? { user: config.user, pass: config.pass }
        : undefined,
    });
    return this.transporter;
  }

  private fromAddress(): string {
    const branding = this.settings.getBranding();
    const smtp = this.settings.getSmtp();
    const address =
      smtp?.from ||
      process.env.PLATFORM_MAIL_FROM ||
      'no-reply@ecomate.bd';
    // PLATFORM_MAIL_FROM may already carry a display name ("Name <a@b>").
    if (address.includes('<')) return address;
    // The stored sender name wins; without one, the platform name is the
    // display name (as before). The name is quoted — fromName is stripped
    // of `"` on write, so quoting is always safe.
    const name = smtp?.fromName?.trim() || branding.platformName;
    return `"${name}" <${address}>`;
  }

  private replyTo(): string | undefined {
    const support = this.settings.getBranding().supportEmail;
    return support || undefined;
  }

  /**
   * Bare shared sender address (no display name) for SaaS relay sends.
   * Shared SMTP cannot send from the tenant's own domain (SPF/DKIM
   * would fail), so SaaS mail sends from this address with the tenant's
   * store name as the display name (§8.2).
   */
  private sharedFromEmail(): string {
    const smtp = this.settings.getSmtp();
    if (smtp?.from) return smtp.from;
    return (
      splitFrom(process.env.PLATFORM_MAIL_FROM ?? '').email ||
      'no-reply@ecomate.bd'
    );
  }

  /**
   * Branding for the email layout: platform name + support contact +
   * logo URL. The layout only ever renders the logo when it is an https
   * URL (data: URLs from console uploads are blocked by most email
   * clients) and falls back to the text wordmark otherwise.
   */
  private brand(): EmailBrand {
    const branding = this.settings.getBranding();
    return {
      platformName: branding.platformName,
      supportEmail: branding.supportEmail,
      logoUrl: branding.logoUrl,
    };
  }

  /**
   * Phase 8 Stage 2 item 20 — ops alert mail (billing-job failure,
   * purge-sweep failure, TLS expiry, primary-domain health). Plain
   * text-first; same fail-closed-in-production / dev-log-fallback
   * behaviour as the billing templates via deliver().
   */
  async sendOpsAlert(input: {
    to: string;
    subject: string;
    text: string;
  }): Promise<{ delivered: boolean }> {
    const platformName = this.settings.getBranding().platformName;
    const subject = `[${platformName} ops] ${input.subject}`;
    return this.deliver(
      input.to,
      subject,
      input.text,
      `<p>${escapeHtml(input.text).replace(/\n/g, '<br/>')}</p>`,
      `ops alert: ${input.subject}`,
    );
  }

  async sendTest(to: string): Promise<{ delivered: boolean }> {
    const transporter = this.getTransporter();
    if (!transporter) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured. Set SMTP settings first.',
      );
    }
    const platformName = this.settings.getBranding().platformName;
    await transporter.sendMail({
      from: this.fromAddress(),
      replyTo: this.replyTo(),
      to,
      subject: `${platformName} test email`,
      text:
        `Hi,\n\nThis is a test email from your ${platformName} platform. ` +
        `If you received it, SMTP delivery is working.\n`,
      html: renderEmailLayout({
        brand: this.brand(),
        heading: 'Test email',
        preheader: `A test email from your ${platformName} platform.`,
        bodyHtml:
          para('Hi,') +
          para(
            `This is a test email from your <strong>${escapeHtml(
              platformName,
            )}</strong> platform. If you received it, SMTP delivery is working.`,
          ),
      }),
    });
    return { delivered: true };
  }

  /**
   * SaaS SMTP relay send (§8.2): a tenant's order/customer email sent
   * through the shared platform transport. From is the shared EcoMate
   * address with the tenant's store name as the display name; Reply-To
   * is the tenant's configured from address when one is given. The
   * tenant's rendered HTML/text is sent as-is (no branded layout wrap —
   * this is the tenant's own mail, not platform mail). Throws when SMTP
   * is unconfigured; the caller checks isConfigured() before consuming
   * balance, so this throw means the config vanished mid-flight.
   */
  async sendRelay(input: {
    to: string;
    subject: string;
    html?: string;
    text?: string;
    /** Tenant store name, used as the sender display name. */
    fromName?: string;
    /** Tenant's configured from address, used as Reply-To. */
    replyTo?: string;
  }): Promise<{ delivered: boolean }> {
    const transporter = this.getTransporter();
    if (!transporter) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured. Set SMTP settings first.',
      );
    }
    const address = this.sharedFromEmail();
    // The store name is tenant input: strip header-breaking characters
    // the same way the settings layer strips fromName on write.
    const name =
      (input.fromName ?? '').trim().replace(/["<>]/g, '') ||
      this.settings.getBranding().platformName;
    await transporter.sendMail({
      from: `"${name}" <${address}>`,
      replyTo: input.replyTo?.trim() || this.replyTo(),
      to: input.to,
      subject: input.subject,
      html: input.html || undefined,
      text: input.text || undefined,
    });
    return { delivered: true };
  }

  /**
   * Low-balance warning (§10.3): sent once per threshold crossing, to
   * the tenant owner. Counts only — no money is ever mentioned.
   */
  async sendLowBalance(input: {
    to: string;
    tenantName: string;
    remaining: number;
    threshold: number;
  }): Promise<{ delivered: boolean }> {
    const platformName = this.settings.getBranding().platformName;
    const remaining = escapeHtml(String(input.remaining));
    return this.deliver(
      input.to,
      `You have ${input.remaining} emails left — ${platformName}`,
      `Hi,\n\nYour workspace ${input.tenantName} has ${input.remaining} ` +
        `emails left on its email balance. Top up from your admin SMTP ` +
        `page to keep sending order emails and customer notifications.\n\n` +
        `When the balance reaches zero, outgoing emails stop until you top up.`,
      renderEmailLayout({
        brand: this.brand(),
        heading: 'Your email balance is running low',
        preheader: `Your workspace ${input.tenantName} has ${input.remaining} emails left.`,
        bodyHtml:
          para('Hi,') +
          para(
            `Your workspace <strong>${escapeHtml(input.tenantName)}</strong> ` +
              `has <strong>${remaining} emails</strong> left on its email balance.`,
          ) +
          para(
            'Top up from your admin SMTP page to keep sending order emails ' +
              'and customer notifications. When the balance reaches zero, ' +
              'outgoing emails stop until you top up.',
          ),
      }),
      `low email balance for ${input.tenantName} (${input.remaining} left)`,
    );
  }

  /**
   * Email-balance expiry warning (§5.2): sent once per lot, warnDays
   * before it expires. Counts only — no money is ever mentioned.
   */
  async sendEmailExpiryWarning(input: {
    to: string;
    tenantName: string;
    emails: number;
    expiresAt: Date | string;
  }): Promise<{ delivered: boolean }> {
    const platformName = this.settings.getBranding().platformName;
    const expires = formatDhakaDate(input.expiresAt);
    return this.deliver(
      input.to,
      `${input.emails} emails expire on ${expires} — ${platformName}`,
      `Hi,\n\n${input.emails} emails on your workspace ${input.tenantName} ` +
        `expire on ${expires}. Use them before then — expired emails are ` +
        `removed from your balance and are not refunded.\n\n` +
        `Your other emails are not affected.`,
      renderEmailLayout({
        brand: this.brand(),
        heading: 'Some of your emails expire soon',
        preheader: `${input.emails} emails expire on ${expires}.`,
        bodyHtml:
          para('Hi,') +
          para(
            `<strong>${escapeHtml(String(input.emails))} emails</strong> on your workspace ` +
              `<strong>${escapeHtml(input.tenantName)}</strong> expire on ` +
              `<strong>${escapeHtml(expires)}</strong>.`,
          ) +
          para(
            'Use them before then — expired emails are removed from your ' +
              'balance and are not refunded. Your other emails are not affected.',
          ),
      }),
      `email expiry warning for ${input.tenantName} (${input.emails} expire ${expires})`,
    );
  }

  async sendVerification(input: {
    to: string;
    tenantName: string;
    verificationUrl: string;
  }): Promise<{ delivered: boolean }> {
    const transporter = this.getTransporter();
    if (!transporter) {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException(
          'Email delivery is not configured. Set SMTP_HOST/SMTP_FROM.',
        );
      }
      // Dev/test: log the link instead of failing the signup.
      this.logger.log(
        `[dev] verification link for ${input.to}: ${input.verificationUrl}`,
      );
      return { delivered: false };
    }

    const name = escapeHtml(input.tenantName);
    await transporter.sendMail({
      from: this.fromAddress(),
      replyTo: this.replyTo(),
      to: input.to,
      subject: `Verify your email for ${input.tenantName}`,
      text:
        `Hi,\n\nConfirm your email to continue setting up ${input.tenantName}:\n\n` +
        `${input.verificationUrl}\n\n` +
        `This link expires in 24 hours. If you did not request this, ignore this email.`,
      html: renderEmailLayout({
        brand: this.brand(),
        heading: 'Confirm your email',
        preheader: `Confirm your email to continue setting up ${input.tenantName}.`,
        bodyHtml:
          para('Hi,') +
          para(
            `Confirm your email to continue setting up <strong>${name}</strong>:`,
          ) +
          para(
            'This link expires in 24 hours. If you did not request this, ignore this email.',
          ),
        cta: { label: 'Verify email', url: input.verificationUrl },
      }),
    });
    return { delivered: true };
  }

  async sendInvite(input: {
    to: string;
    name: string;
    role: string;
    acceptUrl: string;
  }): Promise<{ delivered: boolean }> {
    const transporter = this.getTransporter();
    if (!transporter) {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException(
          'Email delivery is not configured. Set SMTP_HOST/SMTP_FROM.',
        );
      }
      // Dev/test: log the link instead of failing the invite.
      this.logger.log(
        `[dev] invite link for ${input.to}: ${input.acceptUrl}`,
      );
      return { delivered: false };
    }

    const platformName = this.settings.getBranding().platformName;
    const name = escapeHtml(input.name);
    const role = escapeHtml(input.role);
    await transporter.sendMail({
      from: this.fromAddress(),
      replyTo: this.replyTo(),
      to: input.to,
      subject: `Your ${platformName} platform invite`,
      text:
        `Hi ${input.name},\n\nYou have been invited to the ${platformName} ` +
        `platform console as ${input.role}.\n\n` +
        `Accept the invite and set your password:\n\n` +
        `${input.acceptUrl}\n\n` +
        `This link expires in 72 hours. If you did not expect this, ignore this email.`,
      html: renderEmailLayout({
        brand: this.brand(),
        heading: `You're invited to ${platformName}`,
        preheader: `You've been invited to the ${platformName} platform console as ${input.role}.`,
        bodyHtml:
          para(`Hi ${name},`) +
          para(
            `You have been invited to the ` +
              `<strong>${escapeHtml(platformName)}</strong> platform console as ` +
              `<strong>${role}</strong>.`,
          ) +
          para(
            'Accept the invite and set your password. This link expires in 72 hours. If you did not expect this, ignore this email.',
          ),
        cta: { label: 'Accept invite', url: input.acceptUrl },
      }),
    });
    return { delivered: true };
  }

  /**
   * Shared send path for the billing templates: fail-closed in production
   * when SMTP is unconfigured, dev-log fallback otherwise. Returns whether
   * the message was actually handed to a transporter.
   */
  private async deliver(
    to: string,
    subject: string,
    text: string,
    html: string,
    devLog: string,
  ): Promise<{ delivered: boolean }> {
    const transporter = this.getTransporter();
    if (!transporter) {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException(
          'Email delivery is not configured. Set SMTP_HOST/SMTP_FROM.',
        );
      }
      this.logger.log(`[dev] ${devLog} for ${to}`);
      return { delivered: false };
    }
    await transporter.sendMail({
      from: this.fromAddress(),
      replyTo: this.replyTo(),
      to,
      subject,
      text,
      html,
    });
    return { delivered: true };
  }

  async sendInvoice(input: {
    to: string;
    tenantName: string;
    invoiceNumber: string;
    total: number;
    currency: string;
    dueAt: Date | string;
    periodLabel?: string;
  }): Promise<{ delivered: boolean }> {
    const platformName = this.settings.getBranding().platformName;
    const name = escapeHtml(input.tenantName);
    const amount = formatMoney(input.total, input.currency);
    const due = formatDhakaDate(input.dueAt);
    const period = input.periodLabel
      ? ` for the period ${input.periodLabel}`
      : '';
    return this.deliver(
      input.to,
      `Invoice ${input.invoiceNumber} from ${platformName} — ${amount} due ${due}`,
      `Hi,\n\nYour invoice ${input.invoiceNumber}${period} is ready.\n\n` +
        `Amount due: ${amount}\nDue date: ${due}\n\n` +
        `Pay with bKash, Nagad or bank transfer, then submit the transaction ` +
        `id from your admin billing page so we can verify the payment.`,
      renderEmailLayout({
        brand: this.brand(),
        heading: 'Your invoice is ready',
        preheader: `Invoice ${input.invoiceNumber} — ${amount} due ${due}.`,
        bodyHtml:
          para('Hi,') +
          renderDetails([
            { label: 'Invoice', value: input.invoiceNumber },
            ...(input.periodLabel
              ? [{ label: 'Period', value: input.periodLabel }]
              : []),
            { label: 'Amount due', value: amount },
            { label: 'Due date', value: due },
          ]) +
          para(
            'Pay with bKash, Nagad or bank transfer, then submit the ' +
              'transaction id from your admin billing page so we can verify the payment.',
          ),
      }),
      `invoice ${input.invoiceNumber} (${amount}, due ${due})`,
    );
  }

  async sendPaymentApproved(input: {
    to: string;
    tenantName: string;
    invoiceNumber: string;
    amount: number;
    currency: string;
  }): Promise<{ delivered: boolean }> {
    const platformName = this.settings.getBranding().platformName;
    const amount = formatMoney(input.amount, input.currency);
    return this.deliver(
      input.to,
      `Payment approved for invoice ${input.invoiceNumber} — ${platformName}`,
      `Hi,\n\nYour payment of ${amount} for invoice ${input.invoiceNumber} ` +
        `has been approved. Your subscription is active and your workspace ` +
        `is fully available.\n\nThank you for paying on time.`,
      renderEmailLayout({
        brand: this.brand(),
        heading: 'Payment approved',
        preheader: `Your payment of ${amount} for invoice ${input.invoiceNumber} has been approved.`,
        bodyHtml:
          para('Hi,') +
          para(
            `Your payment of <strong>${escapeHtml(amount)}</strong> ` +
              `for invoice <strong>${escapeHtml(input.invoiceNumber)}</strong> ` +
              `has been approved. Your subscription is active and your workspace ` +
              `is fully available.`,
          ) +
          para('Thank you for paying on time.'),
      }),
      `payment approved for invoice ${input.invoiceNumber} (${amount})`,
    );
  }

  async sendPaymentRejected(input: {
    to: string;
    tenantName: string;
    invoiceNumber: string;
    reason: string;
  }): Promise<{ delivered: boolean }> {
    const platformName = this.settings.getBranding().platformName;
    const reason = escapeHtml(input.reason);
    return this.deliver(
      input.to,
      `Payment proof rejected for invoice ${input.invoiceNumber} — ${platformName}`,
      `Hi,\n\nWe could not verify your payment proof for invoice ` +
        `${input.invoiceNumber}.\n\nReason: ${input.reason}\n\n` +
        `Please check the transaction details and submit a new proof from ` +
        `your admin billing page.`,
      renderEmailLayout({
        brand: this.brand(),
        heading: "Payment proof couldn't be verified",
        preheader: `We could not verify your payment proof for invoice ${input.invoiceNumber}.`,
        bodyHtml:
          para('Hi,') +
          para(
            `We could not verify your payment proof for invoice ` +
              `<strong>${escapeHtml(input.invoiceNumber)}</strong>.`,
          ) +
          para(`Reason: ${reason}`) +
          para(
            'Please check the transaction details and submit a new proof from ' +
              'your admin billing page.',
          ),
      }),
      `payment rejected for invoice ${input.invoiceNumber}`,
    );
  }

  async sendTrialEnding(input: {
    to: string;
    tenantName: string;
    trialEndsAt: Date | string;
    planName: string;
  }): Promise<{ delivered: boolean }> {
    const platformName = this.settings.getBranding().platformName;
    const ends = formatDhakaDate(input.trialEndsAt);
    const plan = escapeHtml(input.planName);
    return this.deliver(
      input.to,
      `Your ${input.planName} trial ends on ${ends} — ${platformName}`,
      `Hi,\n\nYour ${input.planName} trial for ${input.tenantName} ends on ` +
        `${ends}. To keep your workspace fully available, choose a plan ` +
        `from your admin subscription page before then — you can review ` +
        `the add-ons from your trial there and keep only the ones you ` +
        `want.\n\n` +
        `After the trial ends you will have a short grace period before ` +
        `the workspace becomes read-only.`,
      renderEmailLayout({
        brand: this.brand(),
        heading: 'Your trial ends soon',
        preheader: `Your ${input.planName} trial ends on ${ends}.`,
        bodyHtml:
          para('Hi,') +
          para(
            `Your <strong>${plan}</strong> trial for ` +
              `<strong>${escapeHtml(input.tenantName)}</strong> ends on ` +
              `<strong>${escapeHtml(ends)}</strong>. To keep your workspace fully ` +
              `available, choose a plan from your admin subscription page ` +
              `before then — you can review the add-ons from your trial ` +
              `there and keep only the ones you want.`,
          ) +
          para(
            'After the trial ends you will have a short grace period before ' +
              'the workspace becomes read-only.',
          ),
      }),
      `trial ending for ${input.tenantName} (${ends})`,
    );
  }

  /**
   * Trial ended (trial-end design 2026-11-22): the tenant has not chosen
   * a plan yet, so there is no invoice to pay — the mail points at the
   * subscription page, where the tenant picks a plan and reviews the
   * trial add-ons. Sent once per subscription (InvoiceReminder kind
   * TRIAL_EXPIRED). When there is no grace window (suspend-immediately
   * policy) graceEndsAt is null and the copy says so.
   */
  async sendTrialExpired(input: {
    to: string;
    tenantName: string;
    graceEndsAt: Date | string | null;
  }): Promise<{ delivered: boolean }> {
    const platformName = this.settings.getBranding().platformName;
    const grace = input.graceEndsAt
      ? formatDhakaDate(input.graceEndsAt)
      : null;
    const graceText = grace
      ? `You have until ${grace} to choose a plan — until then your shop and workspace stay fully available.`
      : 'Your workspace is now suspended — choose a plan from your admin subscription page to restore it.';
    return this.deliver(
      input.to,
      `Your trial has ended — choose a plan to keep your shop running (${platformName})`,
      `Hi,\n\nYour trial for ${input.tenantName} has ended. ${graceText}\n\n` +
        `On the subscription page you can pick a plan and review the ` +
        `add-ons from your trial, keeping only the ones you want. ` +
        `Nothing is billed until you choose.\n\n` +
        `Your products, orders and settings are safe.`,
      renderEmailLayout({
        brand: this.brand(),
        heading: 'Your trial has ended',
        preheader: `Your trial for ${input.tenantName} has ended.`,
        bodyHtml:
          para('Hi,') +
          para(
            `Your trial for <strong>${escapeHtml(input.tenantName)}</strong> ` +
              `has ended. ${escapeHtml(graceText)}`,
          ) +
          para(
            'On the subscription page you can pick a plan and review the ' +
              'add-ons from your trial, keeping only the ones you want. ' +
              'Nothing is billed until you choose.',
          ) +
          para('Your products, orders and settings are safe.'),
      }),
      `trial expired for ${input.tenantName}`,
    );
  }

  async sendSuspension(input: {
    to: string;
    tenantName: string;
    reason?: string;
  }): Promise<{ delivered: boolean }> {
    const platformName = this.settings.getBranding().platformName;
    const reason = input.reason
      ? `\n\nReason: ${input.reason}`
      : '';
    return this.deliver(
      input.to,
      `Your workspace ${input.tenantName} has been suspended — ${platformName}`,
      `Hi,\n\nYour workspace ${input.tenantName} has been suspended because ` +
        `an invoice is overdue past the grace period.${reason}\n\n` +
        `Pay the outstanding invoice from your admin billing page to ` +
        `restore full access. Your data is safe.`,
      renderEmailLayout({
        brand: this.brand(),
        heading: 'Your workspace is suspended',
        preheader: `Your workspace ${input.tenantName} has been suspended.`,
        bodyHtml:
          para('Hi,') +
          para(
            `Your workspace <strong>${escapeHtml(
              input.tenantName,
            )}</strong> has been suspended because an invoice is overdue past the ` +
              `grace period.`,
          ) +
          (input.reason
            ? para(`Reason: ${escapeHtml(input.reason)}`)
            : '') +
          para(
            'Pay the outstanding invoice from your admin billing page to ' +
              'restore full access. Your data is safe.',
          ),
      }),
      `suspension for ${input.tenantName}`,
    );
  }

  async sendReactivation(input: {
    to: string;
    tenantName: string;
  }): Promise<{ delivered: boolean }> {
    const platformName = this.settings.getBranding().platformName;
    return this.deliver(
      input.to,
      `Your workspace ${input.tenantName} is active again — ${platformName}`,
      `Hi,\n\nGood news — your workspace ${input.tenantName} is active ` +
        `again and fully available. Thank you for your payment.`,
      renderEmailLayout({
        brand: this.brand(),
        heading: 'Your workspace is active again',
        preheader: `Your workspace ${input.tenantName} is active again.`,
        bodyHtml:
          para('Hi,') +
          para(
            `Good news — your workspace <strong>${escapeHtml(
              input.tenantName,
            )}</strong> is active again and fully available. Thank you for your payment.`,
          ),
      }),
      `reactivation for ${input.tenantName}`,
    );
  }

  /**
   * Lead notification to the sales inbox (landing lead form). The caller
   * (LeadsService) checks isConfigured() first and never fails the lead
   * submit when delivery throws — a lead is a low-privilege record and
   * the form must work with mail down or unconfigured.
   */
  async sendLeadNotification(input: {
    to: string;
    name: string;
    contact: string;
    contactType: 'email' | 'phone';
    message?: string | null;
    monthlyOrders?: string | null;
  }): Promise<{ delivered: boolean }> {
    const platformName = this.settings.getBranding().platformName;
    const contactLabel = input.contactType === 'email' ? 'Email' : 'Phone';
    const ordersText = input.monthlyOrders?.trim()
      ? input.monthlyOrders.trim()
      : 'Not shared';
    const message = input.message?.trim() ?? '';
    const messageText = message ? `\n\nMessage:\n${message}` : '\n\nNo message.';
    return this.deliver(
      input.to,
      `New lead: ${input.name} — ${platformName}`,
      `Hi,\n\nA new lead came in from the landing page.\n\n` +
        `Name: ${input.name}\n${contactLabel}: ${input.contact}\n` +
        `Monthly orders: ${ordersText}${messageText}`,
      renderEmailLayout({
        brand: this.brand(),
        heading: 'New lead from the landing page',
        preheader: `New lead: ${input.name} (${input.contact}).`,
        bodyHtml:
          para('Hi,') +
          para('A new lead came in from the landing page.') +
          renderDetails([
            { label: 'Name', value: input.name },
            { label: contactLabel, value: input.contact },
            { label: 'Monthly orders', value: ordersText },
          ]) +
          (message
            ? para(
                `Message:<br/>${escapeHtml(message).replace(/\n/g, '<br/>')}`,
              )
            : para('No message.')),
      }),
      `lead notification for ${input.name} (${input.contact})`,
    );
  }

  async sendWelcome(input: {
    to: string;
    tenantName: string;
    adminUrl: string;
    storefrontUrl: string;
  }): Promise<{ delivered: boolean }> {
    const transporter = this.getTransporter();
    if (!transporter) {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException(
          'Email delivery is not configured. Set SMTP_HOST/SMTP_FROM.',
        );
      }
      this.logger.log(
        `[dev] welcome link for ${input.to}: ${input.adminUrl}`,
      );
      return { delivered: false };
    }

    const name = escapeHtml(input.tenantName);
    await transporter.sendMail({
      from: this.fromAddress(),
      replyTo: this.replyTo(),
      to: input.to,
      subject: `${input.tenantName} is ready`,
      text:
        `Hi,\n\n${input.tenantName} is ready.\n\n` +
        `Admin: ${input.adminUrl}\nStorefront: ${input.storefrontUrl}\n\n` +
        `Sign in with the email and password you used at signup.`,
      html: renderEmailLayout({
        brand: this.brand(),
        heading: `${input.tenantName} is ready`,
        preheader: `${input.tenantName} is ready — open the admin to start setting up your store.`,
        bodyHtml:
          para('Hi,') +
          para(`<strong>${name}</strong> is ready.`) +
          para(
            `Your storefront is live too: ${link(input.storefrontUrl, 'Open the storefront')}`,
          ) +
          para('Sign in with the email and password you used at signup.'),
        cta: { label: 'Open the admin', url: input.adminUrl },
      }),
    });
    return { delivered: true };
  }
}
