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
