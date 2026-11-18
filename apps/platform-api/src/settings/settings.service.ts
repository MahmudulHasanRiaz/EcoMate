import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { EncryptionService } from '../common/encryption.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import {
  BRANDING_IMAGE_MAX_LENGTH,
  isBrandingImageUrl,
} from './branding-url';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass?: string;
  from: string;
}

export interface SmtpSettingsPublic {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  configured: boolean;
  /** Where the effective config comes from: env wins when set, else the stored setting. */
  source: 'env' | 'setting' | 'none';
}

export interface TrialSettings {
  trialDays: number;
  graceDays: number;
}

export interface TaxSettings {
  ratePercent: number;
  label: string;
  inclusive: boolean;
}

export interface BrandingSettings {
  platformName: string;
  supportEmail: string;
  logoUrl: string;
  faviconUrl: string;
}

export interface MaintenanceSettings {
  enabled: boolean;
  message: string;
}

/**
 * Public landing behaviour (Batch 1, items 2 + 5). defaultLocale is the
 * locale a first-time visitor sees; seoIndexingEnabled is the
 * search-engine kill-switch (off = robots disallows all, no sitemap,
 * noindex meta). seoIndexingSource discloses where the effective
 * indexing value comes from: SEO_INDEXING_ENABLED env wins when set
 * (staging deploys set it false), else the stored setting.
 */
export interface LandingSettings {
  defaultLocale: 'en' | 'bn';
  seoIndexingEnabled: boolean;
  seoIndexingSource: 'env' | 'setting';
}

export interface AllSettings {
  smtp: SmtpSettingsPublic;
  trial: TrialSettings;
  tax: TaxSettings;
  branding: BrandingSettings;
  maintenance: MaintenanceSettings;
  landing: LandingSettings;
}

export const DEFAULT_TRIAL_DAYS = 14;
export const DEFAULT_GRACE_DAYS = 7;

const DEFAULT_TRIAL: TrialSettings = {
  trialDays: DEFAULT_TRIAL_DAYS,
  graceDays: DEFAULT_GRACE_DAYS,
};

const DEFAULT_TAX: TaxSettings = {
  ratePercent: 0,
  label: '',
  inclusive: false,
};

const DEFAULT_BRANDING: BrandingSettings = {
  platformName: 'EcoMate',
  supportEmail: '',
  logoUrl: '',
  faviconUrl: '',
};

const DEFAULT_MAINTENANCE: MaintenanceSettings = {
  enabled: false,
  message: '',
};

const DEFAULT_LANDING: LandingSettings = {
  defaultLocale: 'en',
  seoIndexingEnabled: true,
  seoIndexingSource: 'setting',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Empty clears the value; a non-empty value must be an http(s) URL or a data:image/* URL. */
function assertImageUrl(value: string, field: string): void {
  if (!value) return;
  if (!isBrandingImageUrl(value)) {
    throw new BadRequestException(
      `${field} must be an http(s) URL or a data:image/* URL no longer than ${BRANDING_IMAGE_MAX_LENGTH} characters`,
    );
  }
}

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private smtp!: SmtpSettingsPublic & { pass?: string };
  private trial: TrialSettings = { ...DEFAULT_TRIAL };
  private tax: TaxSettings = { ...DEFAULT_TAX };
  private branding: BrandingSettings = { ...DEFAULT_BRANDING };
  private maintenance: MaintenanceSettings = { ...DEFAULT_MAINTENANCE };
  private landing: LandingSettings = { ...DEFAULT_LANDING };

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async onModuleInit() {
    await this.loadAll();
  }

  getAll(): AllSettings {
    const { pass: _pass, ...smtp } = this.smtp;
    return {
      smtp,
      trial: { ...this.trial },
      tax: { ...this.tax },
      branding: { ...this.branding },
      maintenance: { ...this.maintenance },
      landing: { ...this.landing },
    };
  }

  /** Full effective SMTP config (including the password) for the mail service. Null when unconfigured. */
  getSmtp(): SmtpSettings | null {
    if (!this.smtp.configured) return null;
    return {
      host: this.smtp.host,
      port: this.smtp.port,
      secure: this.smtp.secure,
      user: this.smtp.user,
      pass: this.smtp.pass,
      from: this.smtp.from,
    };
  }

  getSmtpPublic(): SmtpSettingsPublic {
    const { pass: _pass, ...smtp } = this.smtp;
    return smtp;
  }

  getTrialDefaults(): TrialSettings {
    return { ...this.trial };
  }

  getTax(): TaxSettings {
    return { ...this.tax };
  }

  getBranding(): BrandingSettings {
    return { ...this.branding };
  }

  getMaintenance(): MaintenanceSettings {
    return { ...this.maintenance };
  }

  isMaintenanceEnabled(): boolean {
    return this.maintenance.enabled;
  }

  getLanding(): LandingSettings {
    return { ...this.landing };
  }

  /** Effective search-indexing flag for the public landing. */
  isSeoIndexingEnabled(): boolean {
    return this.landing.seoIndexingEnabled;
  }

  async updateSmtp(input: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
    from?: string;
  }): Promise<SmtpSettingsPublic> {
    const stored = await this.readSmtpStored();
    const current: Partial<SmtpSettings> = isRecord(stored) ? stored : {};
    // Omit = keep the stored password; an explicit value replaces it.
    // `current.pass` is already decrypted by readSmtpStored; store()
    // re-encrypts it, so a kept password is never double-encrypted.
    const pass =
      input.pass !== undefined
        ? input.pass.trim() || undefined
        : current.pass;
    const next: SmtpSettings = {
      host: (input.host ?? current.host ?? '').trim(),
      port: input.port ?? asNumber(current.port, 587),
      secure: input.secure ?? asBoolean(current.secure, false),
      user: (input.user ?? current.user ?? '').trim(),
      pass,
      from: (input.from ?? current.from ?? '').trim(),
    };
    this.validateSmtp(next);
    await this.store('smtp', next);
    // The effective config may still come from env; reload to recompute it.
    await this.loadSmtp();
    this.logger.log(
      `SMTP settings updated (effective source: ${this.smtp.source})`,
    );
    return this.getSmtpPublic();
  }

  async updateTrial(input: {
    trialDays?: number;
    graceDays?: number;
  }): Promise<TrialSettings> {
    const next: TrialSettings = {
      trialDays: input.trialDays ?? this.trial.trialDays,
      graceDays: input.graceDays ?? this.trial.graceDays,
    };
    if (
      !Number.isInteger(next.trialDays) ||
      next.trialDays < 0 ||
      next.trialDays > 365
    ) {
      throw new BadRequestException(
        'trialDays must be an integer between 0 and 365',
      );
    }
    if (
      !Number.isInteger(next.graceDays) ||
      next.graceDays < 0 ||
      next.graceDays > 90
    ) {
      throw new BadRequestException(
        'graceDays must be an integer between 0 and 90',
      );
    }
    await this.store('trial_defaults', next);
    this.trial = next;
    return { ...next };
  }

  async updateTax(input: {
    ratePercent?: number;
    label?: string;
    inclusive?: boolean;
  }): Promise<TaxSettings> {
    const next: TaxSettings = {
      ratePercent: input.ratePercent ?? this.tax.ratePercent,
      label: (input.label ?? this.tax.label).trim(),
      inclusive: input.inclusive ?? this.tax.inclusive,
    };
    if (
      typeof next.ratePercent !== 'number' ||
      !Number.isFinite(next.ratePercent) ||
      next.ratePercent < 0 ||
      next.ratePercent > 100
    ) {
      throw new BadRequestException(
        'ratePercent must be a number between 0 and 100',
      );
    }
    if (next.label.length > 100) {
      throw new BadRequestException('label must be at most 100 characters');
    }
    await this.store('tax', next);
    this.tax = next;
    return { ...next };
  }

  async updateBranding(input: {
    platformName?: string;
    supportEmail?: string;
    logoUrl?: string;
    faviconUrl?: string;
  }): Promise<BrandingSettings> {
    const next: BrandingSettings = {
      platformName: (input.platformName ?? this.branding.platformName).trim(),
      supportEmail: (input.supportEmail ?? this.branding.supportEmail).trim(),
      logoUrl: (input.logoUrl ?? this.branding.logoUrl).trim(),
      faviconUrl: (input.faviconUrl ?? this.branding.faviconUrl).trim(),
    };
    if (!next.platformName || next.platformName.length > 100) {
      throw new BadRequestException(
        'platformName is required and must be at most 100 characters',
      );
    }
    if (
      next.supportEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.supportEmail)
    ) {
      throw new BadRequestException('supportEmail must be a valid email');
    }
    assertImageUrl(next.logoUrl, 'logoUrl');
    assertImageUrl(next.faviconUrl, 'faviconUrl');
    await this.store('branding', next);
    this.branding = next;
    return { ...next };
  }

  async updateMaintenance(input: {
    enabled?: boolean;
    message?: string;
  }): Promise<MaintenanceSettings> {
    const next: MaintenanceSettings = {
      enabled: input.enabled ?? this.maintenance.enabled,
      message: (input.message ?? this.maintenance.message).trim(),
    };
    if (next.message.length > 500) {
      throw new BadRequestException('message must be at most 500 characters');
    }
    await this.store('maintenance', next);
    this.maintenance = next;
    this.logger.log(
      `Maintenance mode ${next.enabled ? 'ENABLED' : 'disabled'}`,
    );
    return { ...next };
  }

  async updateLanding(input: {
    defaultLocale?: string;
    seoIndexingEnabled?: boolean;
  }): Promise<LandingSettings> {
    const defaultLocale =
      input.defaultLocale ?? this.landing.defaultLocale;
    if (defaultLocale !== 'en' && defaultLocale !== 'bn') {
      throw new BadRequestException("defaultLocale must be 'en' or 'bn'");
    }
    const storedIndexing =
      input.seoIndexingEnabled ?? this.storedIndexing;
    await this.store('landing', {
      defaultLocale,
      seoIndexingEnabled: storedIndexing,
    });
    // Reload so the env override (if set) recomputes the effective value.
    await this.loadLanding();
    return { ...this.landing };
  }

  /** Stored indexing value as last read from the DB (env-independent). */
  private storedIndexing = true;

  /**
   * Landing settings precedence (same rule as SMTP): the
   * SEO_INDEXING_ENABLED env var wins when set to 'true'/'false' (staging
   * deploys set it false so staging is never indexed); otherwise the
   * stored PlatformSetting; otherwise the default (indexing on). The
   * stored setting is kept even while env wins, so removing the env var
   * later reveals it again. defaultLocale has no env override.
   */
  private async loadLanding(): Promise<void> {
    const stored = await this.readStored('landing');
    let defaultLocale: 'en' | 'bn' = 'en';
    let storedIndexing = true;
    if (isRecord(stored)) {
      if (stored.defaultLocale === 'en' || stored.defaultLocale === 'bn') {
        defaultLocale = stored.defaultLocale;
      }
      storedIndexing = asBoolean(stored.seoIndexingEnabled, true);
    }
    this.storedIndexing = storedIndexing;
    const envRaw = (process.env.SEO_INDEXING_ENABLED ?? '').trim().toLowerCase();
    if (envRaw === 'true' || envRaw === 'false') {
      this.landing = {
        defaultLocale,
        seoIndexingEnabled: envRaw === 'true',
        seoIndexingSource: 'env',
      };
      return;
    }
    this.landing = {
      defaultLocale,
      seoIndexingEnabled: storedIndexing,
      seoIndexingSource: 'setting',
    };
  }

  private async loadAll(): Promise<void> {
    await this.loadSmtp();
    const trial = await this.readStored('trial_defaults');
    if (isRecord(trial)) {
      this.trial = {
        trialDays: asNumber(trial.trialDays, DEFAULT_TRIAL_DAYS),
        graceDays: asNumber(trial.graceDays, DEFAULT_GRACE_DAYS),
      };
    }
    const tax = await this.readStored('tax');
    if (isRecord(tax)) {
      this.tax = {
        ratePercent: asNumber(tax.ratePercent, 0),
        label: asString(tax.label),
        inclusive: asBoolean(tax.inclusive, false),
      };
    }
    const branding = await this.readStored('branding');
    if (isRecord(branding)) {
      this.branding = {
        platformName:
          asString(branding.platformName) || DEFAULT_BRANDING.platformName,
        supportEmail: asString(branding.supportEmail),
        logoUrl: asString(branding.logoUrl),
        faviconUrl: asString(branding.faviconUrl),
      };
    }
    const maintenance = await this.readStored('maintenance');
    if (isRecord(maintenance)) {
      this.maintenance = {
        enabled: asBoolean(maintenance.enabled, false),
        message: asString(maintenance.message),
      };
    }
    await this.loadLanding();
  }

  /**
   * SMTP precedence (same rule as DEFAULT_PLAN_VERSION_ID): env wins when
   * SMTP_HOST is set; otherwise the stored PlatformSetting; otherwise
   * unconfigured. The stored setting is kept even while env wins, so
   * removing the env vars later reveals it again.
   */
  private async loadSmtp(): Promise<void> {
    const envHost = (process.env.SMTP_HOST ?? '').trim();
    if (envHost) {
      this.smtp = {
        host: envHost,
        port: Number(process.env.SMTP_PORT ?? 587) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        user: (process.env.SMTP_USER ?? '').trim(),
        pass: process.env.SMTP_PASS || undefined,
        from: (process.env.SMTP_FROM ?? process.env.PLATFORM_MAIL_FROM ?? '')
          .trim(),
        configured: true,
        source: 'env',
      };
      return;
    }
    const stored = await this.readSmtpStored();
    if (isRecord(stored) && asString(stored.host)) {
      this.smtp = {
        host: asString(stored.host),
        port: asNumber(stored.port, 587),
        secure: asBoolean(stored.secure, false),
        user: asString(stored.user),
        pass: asString(stored.pass) || undefined,
        from: asString(stored.from),
        configured: true,
        source: 'setting',
      };
      return;
    }
    this.smtp = {
      host: '',
      port: 587,
      secure: false,
      user: '',
      pass: undefined,
      from: (process.env.PLATFORM_MAIL_FROM ?? '').trim(),
      configured: false,
      source: 'none',
    };
  }

  private validateSmtp(config: SmtpSettings): void {
    if (!config.host) {
      throw new BadRequestException('SMTP host is required');
    }
    if (
      !Number.isInteger(config.port) ||
      config.port < 1 ||
      config.port > 65535
    ) {
      throw new BadRequestException('SMTP port must be between 1 and 65535');
    }
    if (config.from && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.from)) {
      throw new BadRequestException('SMTP from must be a valid email');
    }
  }

  private async readStored(key: string): Promise<unknown> {
    try {
      const row = await this.prisma.platformSetting.findUnique({
        where: { key },
      });
      return row?.value ?? null;
    } catch (err) {
      this.logger.warn(
        `PlatformSetting.${key} unavailable; using defaults: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Read the stored SMTP setting with `pass` decrypted when it is
   * ciphertext. A legacy PLAINTEXT password is lazily migrated: it is
   * returned as-is for this boot and re-encrypted at rest (when a key is
   * configured) so the next read finds ciphertext. An undecryptable
   * password (missing/rotated key) fails closed — the setting is treated
   * as absent and the operator gets a loud log line, never a silent
   * plaintext fallback.
   */
  private async readSmtpStored(): Promise<unknown> {
    const stored = await this.readStored('smtp');
    if (!isRecord(stored) || !asString(stored.pass)) return stored;
    const pass = asString(stored.pass);
    if (EncryptionService.isEncrypted(pass)) {
      try {
        return { ...stored, pass: this.encryption.decrypt(pass) };
      } catch (err) {
        this.logger.error(
          `Stored SMTP password cannot be decrypted (APP_ENCRYPTION_KEY missing or rotated); SMTP is unconfigured until the password is re-entered: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return { ...stored, pass: undefined, host: '' };
      }
    }
    // Legacy plaintext row: migrate it now (no-op without a key).
    if (this.encryption.isConfigured()) {
      try {
        await this.store('smtp', stored);
        this.logger.log(
          'Migrated a legacy plaintext SMTP password to encrypted storage',
        );
      } catch (err) {
        this.logger.warn(
          `SMTP password re-encryption failed; using the plaintext row this boot: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return stored;
  }

  private async store(key: string, value: unknown): Promise<void> {
    // The SMTP password is encrypted at rest (AES-256-GCM); every other
    // setting is stored as-is. An already-encrypted value is left alone.
    if (key === 'smtp' && isRecord(value)) {
      const pass = asString(value.pass);
      if (pass && !EncryptionService.isEncrypted(pass)) {
        value = { ...value, pass: this.encryption.encrypt(pass) };
      }
    }
    await this.prisma.platformSetting.upsert({
      where: { key },
      update: { value: value as any },
      create: { key, value: value as any },
    });
  }
}
