import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { SettingsService } from '../settings/settings.service';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
    return `${branding.platformName} <${address}>`;
  }

  private replyTo(): string | undefined {
    const support = this.settings.getBranding().supportEmail;
    return support || undefined;
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
      html: `<p>Hi,</p><p>This is a test email from your <strong>${escapeHtml(
        platformName,
      )}</strong> platform. If you received it, SMTP delivery is working.</p>`,
    });
    return { delivered: true };
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
      html:
        `<p>Hi,</p><p>Confirm your email to continue setting up <strong>${name}</strong>:</p>` +
        `<p><a href="${escapeHtml(input.verificationUrl)}">Verify email</a></p>` +
        `<p>This link expires in 24 hours. If you did not request this, ignore this email.</p>`,
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
      html:
        `<p>Hi ${name},</p><p>You have been invited to the ` +
        `<strong>${escapeHtml(platformName)}</strong> platform console as ` +
        `<strong>${role}</strong>.</p>` +
        `<p><a href="${escapeHtml(input.acceptUrl)}">Accept the invite and set your password</a></p>` +
        `<p>This link expires in 72 hours. If you did not expect this, ignore this email.</p>`,
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
      `<p>Hi,</p><p>Your invoice <strong>${escapeHtml(
        input.invoiceNumber,
      )}</strong>${escapeHtml(period)} is ready.</p>` +
        `<p>Amount due: <strong>${escapeHtml(amount)}</strong><br/>` +
        `Due date: <strong>${escapeHtml(due)}</strong></p>` +
        `<p>Pay with bKash, Nagad or bank transfer, then submit the ` +
        `transaction id from your admin billing page so we can verify the payment.</p>`,
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
      `<p>Hi,</p><p>Your payment of <strong>${escapeHtml(amount)}</strong> ` +
        `for invoice <strong>${escapeHtml(input.invoiceNumber)}</strong> ` +
        `has been approved. Your subscription is active and your workspace ` +
        `is fully available.</p><p>Thank you for paying on time.</p>`,
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
      `<p>Hi,</p><p>We could not verify your payment proof for invoice ` +
        `<strong>${escapeHtml(input.invoiceNumber)}</strong>.</p>` +
        `<p>Reason: ${reason}</p>` +
        `<p>Please check the transaction details and submit a new proof from ` +
        `your admin billing page.</p>`,
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
        `${ends}. To keep your workspace fully available, pay the renewal ` +
        `invoice from your admin billing page before then.\n\n` +
        `After the trial ends you will have a short grace period before ` +
        `the workspace becomes read-only.`,
      `<p>Hi,</p><p>Your <strong>${plan}</strong> trial for ` +
        `<strong>${escapeHtml(input.tenantName)}</strong> ends on ` +
        `<strong>${escapeHtml(ends)}</strong>. To keep your workspace fully ` +
        `available, pay the renewal invoice from your admin billing page ` +
        `before then.</p>` +
        `<p>After the trial ends you will have a short grace period before ` +
        `the workspace becomes read-only.</p>`,
      `trial ending for ${input.tenantName} (${ends})`,
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
    const reasonHtml = input.reason
      ? `<p>Reason: ${escapeHtml(input.reason)}</p>`
      : '';
    return this.deliver(
      input.to,
      `Your workspace ${input.tenantName} has been suspended — ${platformName}`,
      `Hi,\n\nYour workspace ${input.tenantName} has been suspended because ` +
        `an invoice is overdue past the grace period.${reason}\n\n` +
        `Pay the outstanding invoice from your admin billing page to ` +
        `restore full access. Your data is safe.`,
      `<p>Hi,</p><p>Your workspace <strong>${escapeHtml(
        input.tenantName,
      )}</strong> has been suspended because an invoice is overdue past the ` +
        `grace period.</p>${reasonHtml}` +
        `<p>Pay the outstanding invoice from your admin billing page to ` +
        `restore full access. Your data is safe.</p>`,
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
      `<p>Hi,</p><p>Good news — your workspace <strong>${escapeHtml(
        input.tenantName,
      )}</strong> is active again and fully available. Thank you for your payment.</p>`,
      `reactivation for ${input.tenantName}`,
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
    const admin = escapeHtml(input.adminUrl);
    const store = escapeHtml(input.storefrontUrl);
    await transporter.sendMail({
      from: this.fromAddress(),
      replyTo: this.replyTo(),
      to: input.to,
      subject: `${input.tenantName} is ready`,
      text:
        `Hi,\n\n${input.tenantName} is ready.\n\n` +
        `Admin: ${input.adminUrl}\nStorefront: ${input.storefrontUrl}\n\n` +
        `Sign in with the email and password you used at signup.`,
      html:
        `<p>Hi,</p><p><strong>${name}</strong> is ready.</p>` +
        `<p><a href="${admin}">Open the admin</a><br/>` +
        `<a href="${store}">Open the storefront</a></p>` +
        `<p>Sign in with the email and password you used at signup.</p>`,
    });
    return { delivered: true };
  }
}
