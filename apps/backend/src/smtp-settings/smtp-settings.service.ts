import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EncryptionService } from '../common/utils/encryption';
import { PrismaService } from '../prisma/prisma.service';

const FETCH_TIMEOUT_MS = 10_000;

const LEGACY_SMTP_KEYS = [
  'smtp_host',
  'smtp_port',
  'smtp_user',
  'smtp_pass',
  'smtp_from_email',
  'smtp_from_name',
] as const;

export type SmtpMode = 'BYO' | 'SAAS';
export type SmtpEncryption = 'NONE' | 'STARTTLS' | 'SSL';

/**
 * The tenant's effective SMTP config. `password` is the DECRYPTED
 * password for internal use only (processor + test) — it never leaves
 * this service. API responses use the public view (hasPassword flag).
 */
export interface ResolvedSmtpConfig {
  mode: SmtpMode;
  enabled: boolean;
  host: string | null;
  port: number | null;
  username: string | null;
  password: string | null;
  hasPassword: boolean;
  encryption: SmtpEncryption;
  fromEmail: string | null;
  fromName: string | null;
}

export type SmtpSettingsPublic = Omit<ResolvedSmtpConfig, 'password'>;

/**
 * Turn a raw mail transport error into a message that is safe to show
 * the tenant. Mirrors the platform's sanitizeMailErrorMessage: the
 * operator's own host/port wording stays, anything credential-shaped is
 * redacted, and the result is capped. Never returns an empty string.
 */
export function sanitizeSmtpErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const redacted = raw
    .trim()
    .replace(
      /(password|passwd|pwd|pass|secret|token)\s*[:=]\s*\S+/gi,
      '$1: [redacted]',
    )
    .replace(/\/\/[^/\s:]+:[^/\s@]+@/g, '//[redacted]@')
    .replace(/(authorization:\s*)\S+/gi, '$1[redacted]');
  const m = redacted.toLowerCase();
  let hint: string | null = null;
  if (/invalid login|authentication failed|\b535\b|\b530\b/.test(m)) {
    hint = 'SMTP authentication failed';
  } else if (/econnrefused|connection refused/.test(m)) {
    hint = 'Could not connect to the SMTP server';
  } else if (/timed out/.test(m)) {
    hint = 'Connection to the SMTP server timed out';
  } else if (/enotfound|getaddrinfo|dns lookup/.test(m)) {
    hint = 'SMTP host could not be resolved';
  } else if (/certificate|self signed|unable to verify the first certificate/.test(m)) {
    hint = 'TLS certificate problem';
  } else if (/wrong version number|handshake failure|ssl routines|\btls\b/.test(m)) {
    hint = 'TLS handshake failed';
  }
  const combined = hint ? `${hint}: ${redacted}` : redacted;
  const trimmed = combined.slice(0, 300).trim();
  return trimmed || 'SMTP operation failed.';
}

function parsePort(value: string | null | undefined): number | null {
  if (!value || !/^[0-9]+$/.test(value.trim())) return null;
  const port = Number(value.trim());
  return port >= 1 && port <= 65535 ? port : null;
}

/**
 * Tenant SMTP settings (smtp-balance-design.md §8.1, §9). One SmtpConfig
 * row per tenant: BYO (own SMTP, any provider, no charge) or SAAS
 * (shared EcoMate SMTP via the platform relay, billed against the
 * prepaid email balance). Default SAAS — a new tenant sends immediately
 * against the free grant; BYO is opt-in.
 *
 * Callers MUST pass the tenant id from the tenant context
 * (requireTenantId() / job.data.tenantId): RLS + the tenant_id_guard
 * trigger scope every read/write to the context tenant, so a mismatched
 * id would read nothing and write under the wrong tenant.
 */
@Injectable()
export class SmtpSettingsService {
  private readonly logger = new Logger(SmtpSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  // ── Resolution + lazy legacy migration (§9.2) ────────────────────────

  /**
   * Resolve the tenant's effective config. A missing row is created
   * (from the legacy SystemSetting keys when they exist — the backfill
   * safety net — otherwise the SAAS default). A row without an
   * encrypted password triggers the lazy password migration: the legacy
   * plaintext smtp_pass is encrypted into passwordEncrypted and the
   * legacy key deleted, so after one resolve no plaintext password
   * remains. The other legacy keys stay until the manual cleanup (§9.2).
   */
  async resolve(tenantId: string): Promise<ResolvedSmtpConfig> {
    let row = await this.prisma.smtpConfig.findUnique({
      where: { tenantId },
    });
    if (!row) {
      row = await this.createFromLegacyOrDefault(tenantId);
    } else if (!row.passwordEncrypted) {
      row = (await this.migrateLegacyPassword(tenantId, row)) ?? row;
    }
    return this.toResolved(row);
  }

  private async createFromLegacyOrDefault(tenantId: string) {
    const legacy = await this.readLegacyKeys(tenantId);
    if (legacy['smtp_host']) {
      const port = parsePort(legacy['smtp_port']);
      const created = await this.prisma.smtpConfig.create({
        data: {
          tenantId,
          mode: 'BYO',
          host: legacy['smtp_host'],
          port,
          username: legacy['smtp_user'] ?? null,
          // Legacy rows had no encryption field: port 465 was implicit
          // TLS in the old processor (secure: port === '465').
          encryption: port === 465 ? 'SSL' : 'STARTTLS',
          fromEmail: legacy['smtp_from_email'] ?? null,
          fromName: legacy['smtp_from_name'] ?? null,
        },
      });
      return (await this.migrateLegacyPassword(tenantId, created)) ?? created;
    }
    return this.prisma.smtpConfig.create({ data: { tenantId } });
  }

  /**
   * Lazy password migration (§9.2 step 2). Returns the updated row, or
   * null when there was nothing to migrate (no legacy key, or no
   * encryption key configured — the legacy key is left in place and the
   * failure is logged loudly, never silently dropped).
   */
  private async migrateLegacyPassword(
    tenantId: string,
    row: { passwordEncrypted: string | null },
  ) {
    if (row.passwordEncrypted) return null;
    const legacy = await this.prisma.systemSetting.findUnique({
      where: { tenantId_key: { tenantId, key: 'smtp_pass' } },
    });
    if (!legacy?.value) return null;
    if (!this.encryption.isConfigured()) {
      this.logger.error(
        `Cannot migrate legacy smtp_pass for tenant ${tenantId}: APP_ENCRYPTION_KEY is not configured. The plaintext key stays until a key is configured.`,
      );
      return null;
    }
    const updated = await this.prisma.smtpConfig.update({
      where: { tenantId },
      data: { passwordEncrypted: this.encryption.encrypt(legacy.value) },
    });
    await this.prisma.systemSetting.delete({
      where: { tenantId_key: { tenantId, key: 'smtp_pass' } },
    });
    this.logger.log(
      `Migrated legacy plaintext smtp_pass for tenant ${tenantId} to encrypted storage`,
    );
    return updated;
  }

  private async readLegacyKeys(
    tenantId: string,
  ): Promise<Record<string, string>> {
    const settings = await this.prisma.systemSetting.findMany({
      where: { tenantId, key: { in: [...LEGACY_SMTP_KEYS] } },
    });
    return Object.fromEntries(settings.map((s) => [s.key, s.value]));
  }

  private toResolved(row: {
    tenantId: string;
    mode: SmtpMode;
    enabled: boolean;
    host: string | null;
    port: number | null;
    username: string | null;
    passwordEncrypted: string | null;
    encryption: SmtpEncryption;
    fromEmail: string | null;
    fromName: string | null;
  }): ResolvedSmtpConfig {
    let password: string | null = null;
    if (row.passwordEncrypted) {
      try {
        password = this.encryption.decrypt(row.passwordEncrypted);
      } catch {
        // Fail closed: an undecryptable password (missing/rotated key)
        // makes BYO invalid until the password is re-entered — never a
        // silent plaintext fallback.
        this.logger.error(
          `Stored SMTP password for tenant ${row.tenantId} cannot be decrypted (APP_ENCRYPTION_KEY missing or rotated); BYO sends will fail until the password is re-entered`,
        );
        password = null;
      }
    }
    return {
      mode: row.mode,
      enabled: row.enabled,
      host: row.host,
      port: row.port,
      username: row.username,
      password,
      hasPassword: !!row.passwordEncrypted,
      encryption: row.encryption,
      fromEmail: row.fromEmail,
      fromName: row.fromName,
    };
  }

  /** Public view: everything except the decrypted password. */
  toPublic(config: ResolvedSmtpConfig): SmtpSettingsPublic {
    const { password: _password, ...pub } = config;
    return pub;
  }

  /** Is the BYO config complete enough to send? (Host + valid port; a username without a password is a misconfiguration.) */
  isByoValid(config: ResolvedSmtpConfig): boolean {
    if (!config.host?.trim()) return false;
    if (config.port !== null && (config.port < 1 || config.port > 65535)) {
      return false;
    }
    if (config.username?.trim() && !config.password) return false;
    return true;
  }

  /** The specific reason a BYO config is invalid (for the loud failure, §2.5). */
  byoInvalidReason(config: ResolvedSmtpConfig): string | null {
    if (!config.host?.trim()) return 'SMTP host is not set';
    if (config.port !== null && (config.port < 1 || config.port > 65535)) {
      return 'SMTP port is invalid';
    }
    if (config.username?.trim() && !config.password) {
      return 'SMTP username is set but the password is missing (re-enter it on the SMTP page)';
    }
    return null;
  }

  buildTransporter(config: ResolvedSmtpConfig) {
    return nodemailer.createTransport({
      host: config.host as string,
      port: config.port ?? 587,
      secure: config.encryption === 'SSL',
      requireTLS: config.encryption === 'STARTTLS' ? true : undefined,
      ignoreTLS: config.encryption === 'NONE' ? true : undefined,
      auth: config.username
        ? { user: config.username, pass: config.password ?? '' }
        : undefined,
    });
  }

  // ── Settings page API (§12.3) ───────────────────────────────────────

  /** Settings + balance summary for the tenant admin SMTP page. The balance is proxied best-effort: a platform outage shows a warning, never a broken page. */
  async getSettings(tenantId: string) {
    const config = await this.resolve(tenantId);
    let balance: unknown = null;
    let balanceError: string | null = null;
    try {
      balance = await this.platformFetch(
        `/internal/email-balance?tenantId=${encodeURIComponent(tenantId)}`,
      );
    } catch (error) {
      balanceError = 'Email balance is temporarily unavailable';
      this.logger.warn(
        `Email balance proxy failed for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { ...this.toPublic(config), balance, balanceError };
  }

  /**
   * Update mode + BYO fields (password write-only: an explicit value
   * replaces, an empty string clears, omitted keeps). Mode switch to
   * BYO — and any BYO connection-field change — requires a passing live
   * verification against the merged config (§9.3 test gate): the save
   * itself is the test, so a tenant can never switch to a broken BYO
   * config. Display-only changes (from name/address, enabled) skip the
   * verification.
   */
  async updateSettings(
    tenantId: string,
    dto: {
      mode?: SmtpMode;
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      encryption?: SmtpEncryption;
      fromEmail?: string;
      fromName?: string;
      enabled?: boolean;
    },
  ) {
    const current = await this.resolve(tenantId);
    const next = {
      mode: dto.mode ?? current.mode,
      host:
        dto.host !== undefined ? dto.host.trim() || null : current.host,
      port: dto.port !== undefined ? dto.port : current.port,
      username:
        dto.username !== undefined
          ? dto.username.trim() || null
          : current.username,
      encryption: dto.encryption ?? current.encryption,
      fromEmail:
        dto.fromEmail !== undefined
          ? dto.fromEmail.trim() || null
          : current.fromEmail,
      fromName:
        dto.fromName !== undefined
          ? dto.fromName.trim() || null
          : current.fromName,
      enabled: dto.enabled ?? current.enabled,
    };

    let passwordEncrypted: string | null | undefined;
    if (dto.password !== undefined) {
      if (dto.password === '') {
        passwordEncrypted = null;
      } else {
        if (!this.encryption.isConfigured()) {
          throw new BadRequestException(
            'Cannot store an SMTP password: APP_ENCRYPTION_KEY is not configured',
          );
        }
        passwordEncrypted = this.encryption.encrypt(dto.password);
      }
    }

    const connectionChanged =
      dto.host !== undefined ||
      dto.port !== undefined ||
      dto.username !== undefined ||
      dto.password !== undefined ||
      dto.encryption !== undefined;
    const switchingToByo = next.mode === 'BYO' && current.mode !== 'BYO';
    if (next.mode === 'BYO' && (switchingToByo || connectionChanged)) {
      const candidate: ResolvedSmtpConfig = {
        ...next,
        password:
          dto.password !== undefined
            ? dto.password || null
            : current.password,
        hasPassword:
          dto.password !== undefined
            ? dto.password !== ''
            : current.hasPassword,
      };
      const reason = this.byoInvalidReason(candidate);
      if (reason) {
        throw new BadRequestException(
          `Cannot switch to Own SMTP: ${reason}`,
        );
      }
      await this.verifyTransport(candidate);
    }

    const updated = await this.prisma.smtpConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        ...next,
        passwordEncrypted: passwordEncrypted ?? null,
      },
      update: {
        ...next,
        ...(passwordEncrypted !== undefined ? { passwordEncrypted } : {}),
      },
    });
    return this.toPublic(this.toResolved(updated));
  }

  /** Verify a BYO config live (transporter.verify). Throws BadRequest with the specific cause. */
  async verifyTransport(config: ResolvedSmtpConfig): Promise<void> {
    const transporter = this.buildTransporter(config);
    try {
      await transporter.verify();
    } catch (err) {
      throw new BadRequestException(
        `SMTP verification failed: ${sanitizeSmtpErrorMessage(err)}`,
      );
    } finally {
      transporter.close();
    }
  }

  /** Send a real test email via the BYO config (§9.3) and report the honest result. */
  async testEmail(
    tenantId: string,
    to: string,
  ): Promise<{ delivered: boolean; to: string }> {
    const config = await this.resolve(tenantId);
    if (config.mode !== 'BYO') {
      throw new BadRequestException(
        'Test email is only available in Own SMTP (BYO) mode — EcoMate SMTP needs no test',
      );
    }
    const reason = this.byoInvalidReason(config);
    if (reason) {
      throw new BadRequestException(`SMTP is not configured: ${reason}`);
    }
    const transporter = this.buildTransporter(config);
    try {
      await transporter.sendMail({
        from: `"${config.fromName || 'EcoMate'}" <${config.fromEmail || config.username || 'noreply@ecomate.bd'}>`,
        to,
        subject: 'EcoMate SMTP test email',
        text: 'This is a test email from your store. If you received it, your SMTP settings work.',
        html: '<p>This is a test email from your store. If you received it, your SMTP settings work.</p>',
      });
    } catch (err) {
      throw new BadRequestException(
        `Test email failed: ${sanitizeSmtpErrorMessage(err)}`,
      );
    } finally {
      transporter.close();
    }
    return { delivered: true, to };
  }

  /** Create a top-up invoice via the platform (same flow as the console endpoint). */
  createTopUp(tenantId: string, amountBDT: number) {
    return this.platformFetch(
      `/internal/tenants/${encodeURIComponent(tenantId)}/email-topups`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountBDT }),
      },
    );
  }

  // ── Platform relay client (§8.2, used by the email processor) ───────

  /** Send one email through the platform SaaS relay (consume + send). */
  sendViaRelay(input: {
    tenantId: string;
    to: string;
    subject: string;
    html?: string;
    text?: string;
    reference: string;
    replyTo?: string;
  }): Promise<{
    sent: boolean;
    reason?: string;
    remaining: number;
  }> {
    return this.platformFetch('/internal/saas-smtp/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  // ── Platform fetch (mirrors TenantBillingService) ───────────────────

  private platformBase(): string {
    const base = process.env.PLATFORM_API_URL;
    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!base || !secret) {
      throw new ServiceUnavailableException(
        'Platform API is not configured for this workspace (PLATFORM_API_URL / INTERNAL_SERVICE_SECRET)',
      );
    }
    return base.replace(/\/+$/, '');
  }

  private async platformFetch(path: string, init?: RequestInit): Promise<any> {
    const base = this.platformBase();
    const secret = process.env.INTERNAL_SERVICE_SECRET!;
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        'x-platform-service-token': secret,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const message =
        body?.message ??
        (typeof body === 'string' ? body : null) ??
        `Platform request failed (${response.status})`;
      throw new HttpException(message, response.status);
    }
    return response.json().catch(() => null);
  }
}
