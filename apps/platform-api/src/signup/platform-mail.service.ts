import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';

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
  private readonly transporter: Transporter | null;

  constructor() {
    const host = process.env.SMTP_HOST;
    if (!host) {
      this.transporter = null;
      return;
    }
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  async sendVerification(input: {
    to: string;
    tenantName: string;
    verificationUrl: string;
  }): Promise<{ delivered: boolean }> {
    const from =
      process.env.PLATFORM_MAIL_FROM || 'EcoMate <no-reply@ecomate.bd>';

    if (!this.transporter) {
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
    await this.transporter.sendMail({
      from,
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
}
