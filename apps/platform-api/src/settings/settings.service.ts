import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { EncryptionService } from '../common/encryption.service';
import {
  AD_PLATFORMS,
  getAdPlatform,
  isKnownAdPlatform,
} from '../ad-dispatch/ad-platforms';
import {
  DEFAULT_SAAS_SMTP,
  SAAS_SMTP_FREE_ALLOWANCE_MAX,
  type SaasSmtpSettings,
} from '../email-balance/email-balance.utils';
import { LeadStatus } from '../generated/prisma/client';
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
  /** Display name for outgoing mail ("EcoMate" in "EcoMate <a@b>"). Split
   * out of the legacy combined `from` value (StackMate apply round). */
  fromName: string;
}

export interface SmtpSettingsPublic {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  fromName: string;
  configured: boolean;
  /** Where the effective config comes from: env wins when set, else the stored setting. */
  source: 'env' | 'setting' | 'none';
}

/**
 * What happens when a trial-plan trial ends (trial-end design 2026-11-22).
 * grace_then_suspend: PAST_DUE + grace window (shop stays up), then the
 * existing suspend/cancel jobs take over. suspend_immediately: the tenant
 * is suspended at trial end with no grace and no invoice — the hub still
 * works from the suspended state, so conversion remains possible.
 */
export type TrialEndPolicy = 'grace_then_suspend' | 'suspend_immediately';

export const TRIAL_END_POLICIES: TrialEndPolicy[] = [
  'grace_then_suspend',
  'suspend_immediately',
];

export interface TrialSettings {
  trialDays: number;
  graceDays: number;
  /**
   * Add-on slugs a new trial includes (trial-plan signups only).
   * null = unset: today's behaviour — every active add-on except
   * custom-domain. [] = a trial with no add-ons. Changing this affects
   * NEW signups only; existing trials are untouched.
   */
  trialAddOnSlugs: string[] | null;
  trialEndPolicy: TrialEndPolicy;
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

/**
 * Per-platform ad tracking config (CMS batch 2, item 21). One config
 * per platform id (meta, tiktok, …): the pixel/dataset id, the
 * Conversions/Events API access token (ENCRYPTED at rest like the SMTP
 * password, never returned in plaintext reads), the dispatch mode, the
 * LeadStatus that fires a validated-mode dispatch, and the event name.
 * Stored as one PlatformSetting row (`ad_tracking`), keyed by platform.
 */
export type AdTrackingMode = 'instant' | 'validated';

export interface AdPlatformSettingsInternal {
  pixelId: string;
  /** Decrypted access token — internal only, never serialized. */
  accessToken?: string;
  mode: AdTrackingMode;
  triggerStatus: string;
  eventName: string;
  enabled: boolean;
}

export interface AdPlatformSettingsPublic {
  pixelId: string;
  /** A token is stored (the value itself is never returned). */
  hasToken: boolean;
  /** Ready to dispatch: enabled + pixel id + token. */
  configured: boolean;
  mode: AdTrackingMode;
  triggerStatus: string;
  eventName: string;
  enabled: boolean;
}

export type AdTrackingSettingsInternal = Record<
  string,
  AdPlatformSettingsInternal
>;
export type AdTrackingSettingsPublic = Record<
  string,
  AdPlatformSettingsPublic
>;

export interface AllSettings {
  smtp: SmtpSettingsPublic;
  trial: TrialSettings;
  tax: TaxSettings;
  branding: BrandingSettings;
  maintenance: MaintenanceSettings;
  landing: LandingSettings;
  saasSmtp: SaasSmtpSettings;
  adTracking: AdTrackingSettingsPublic;
}

export const DEFAULT_TRIAL_DAYS = 14;
export const DEFAULT_GRACE_DAYS = 7;

const DEFAULT_TRIAL: TrialSettings = {
  trialDays: DEFAULT_TRIAL_DAYS,
  graceDays: DEFAULT_GRACE_DAYS,
  trialAddOnSlugs: null,
  trialEndPolicy: 'grace_then_suspend',
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

/** Default trigger status for validated-mode dispatch (a warm lead). */
export const DEFAULT_AD_TRIGGER_STATUS = 'QUALIFIED';

/** Fresh default config for one platform (unconfigured: no id/token). */
export function defaultAdPlatform(
  platformId: string,
): AdPlatformSettingsInternal {
  return {
    pixelId: '',
    accessToken: undefined,
    mode: 'instant',
    triggerStatus: DEFAULT_AD_TRIGGER_STATUS,
    eventName: getAdPlatform(platformId)?.defaultEventName ?? 'Lead',
    enabled: true,
  };
}

function defaultAdTracking(): AdTrackingSettingsInternal {
  const out: AdTrackingSettingsInternal = {};
  for (const platform of AD_PLATFORMS) {
    out[platform.id] = defaultAdPlatform(platform.id);
  }
  return out;
}

/** Defensive parse of one stored platform row (bad fields → defaults). */
function parseAdPlatformRow(
  platformId: string,
  row: Record<string, unknown>,
): AdPlatformSettingsInternal {
  const fallback = defaultAdPlatform(platformId);
  const mode = row.mode === 'validated' ? 'validated' : 'instant';
  const triggerStatus =
    typeof row.triggerStatus === 'string' &&
    (Object.values(LeadStatus) as string[]).includes(row.triggerStatus)
      ? row.triggerStatus
      : fallback.triggerStatus;
  const eventName =
    typeof row.eventName === 'string' && row.eventName.trim()
      ? row.eventName.trim()
      : fallback.eventName;
  return {
    pixelId: asString(row.pixelId),
    accessToken: asString(row.accessToken) || undefined,
    mode,
    triggerStatus,
    eventName,
    enabled: asBoolean(row.enabled, true),
  };
}

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

/**
 * Split a legacy combined "Name <email>" from-value into its parts.
 * Pre-fromName settings (and SMTP_FROM / PLATFORM_MAIL_FROM env vars)
 * stored the display name inside `from`; parsing on read keeps those
 * rows working — and validatable, since validateSmtp requires a bare
 * email — without a migration. A bare email returns { name: '', email }.
 * The name is stripped of `"` / `<` / `>` so it can be safely quoted
 * back into a header by the mail service.
 */
export function splitFrom(value: string): { name: string; email: string } {
  const match = value.match(
    /^\s*(?:"?([^"<>]*)"?\s*)?<([^<>@\s]+@[^<>@\s]+)>\s*$/,
  );
  if (match) {
    return {
      name: (match[1] ?? '').trim().replace(/^"|"$/g, ''),
      email: match[2],
    };
  }
  return { name: '', email: value.trim() };
}

/** Max sender-name length (DTO + service agree). */
export const SMTP_FROM_NAME_MAX_LENGTH = 100;

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
  private saasSmtp: SaasSmtpSettings = {
    ...DEFAULT_SAAS_SMTP,
    expiry: { ...DEFAULT_SAAS_SMTP.expiry },
  };
  private adTracking: AdTrackingSettingsInternal = defaultAdTracking();

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
      trial: this.getTrialDefaults(),
      tax: { ...this.tax },
      branding: { ...this.branding },
      maintenance: { ...this.maintenance },
      landing: { ...this.landing },
      saasSmtp: this.getSaasSmtp(),
      adTracking: this.getAdTracking(),
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
      fromName: this.smtp.fromName,
    };
  }

  getSmtpPublic(): SmtpSettingsPublic {
    const { pass: _pass, ...smtp } = this.smtp;
    return smtp;
  }

  getTrialDefaults(): TrialSettings {
    return {
      ...this.trial,
      trialAddOnSlugs: this.trial.trialAddOnSlugs
        ? [...this.trial.trialAddOnSlugs]
        : null,
    };
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

  /** SaaS SMTP rate + free allowance + expiry settings (§3). A deep copy — callers must not mutate the cached row. */
  getSaasSmtp(): SaasSmtpSettings {
    return {
      ...this.saasSmtp,
      expiry: { ...this.saasSmtp.expiry },
    };
  }

  /**
   * Public per-platform ad config: tokens are replaced by `hasToken`
   * and `configured` — the token value NEVER leaves this service via
   * this getter. Every known platform is present (defaults merged),
   * so the console renders a card per platform without its own list.
   * Deep copy — callers must not mutate the cached row.
   */
  getAdTracking(): AdTrackingSettingsPublic {
    const out: AdTrackingSettingsPublic = {};
    for (const platform of AD_PLATFORMS) {
      const cfg =
        this.adTracking[platform.id] ?? defaultAdPlatform(platform.id);
      const hasToken = (cfg.accessToken?.trim().length ?? 0) > 0;
      out[platform.id] = {
        pixelId: cfg.pixelId,
        hasToken,
        configured: cfg.enabled && cfg.pixelId.trim().length > 0 && hasToken,
        mode: cfg.mode,
        triggerStatus: cfg.triggerStatus,
        eventName: cfg.eventName,
        enabled: cfg.enabled,
      };
    }
    return out;
  }

  /** Full per-platform ad config (decrypted tokens) for the dispatcher. Deep copy. */
  getAdTrackingInternal(): AdTrackingSettingsInternal {
    const out: AdTrackingSettingsInternal = {};
    for (const platform of AD_PLATFORMS) {
      const cfg =
        this.adTracking[platform.id] ?? defaultAdPlatform(platform.id);
      out[platform.id] = { ...cfg };
    }
    return out;
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
    fromName?: string;
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
    // The incoming `from` may still be a legacy combined "Name <email>"
    // (a direct API caller, or the stored value on a partial PATCH) —
    // split it so `from` is always stored as a bare email. The sender
    // name changes only when explicitly provided, or when the incoming
    // `from` carries one; otherwise the stored name is kept.
    const incomingFrom = (input.from ?? current.from ?? '').trim();
    const parsedFrom = splitFrom(incomingFrom);
    const fromName =
      input.fromName !== undefined
        ? input.fromName.trim().replace(/["<>]/g, '')
        : parsedFrom.name ||
          (typeof current.fromName === 'string' ? current.fromName : '');
    const next: SmtpSettings = {
      host: (input.host ?? current.host ?? '').trim(),
      port: input.port ?? asNumber(current.port, 587),
      secure: input.secure ?? asBoolean(current.secure, false),
      user: (input.user ?? current.user ?? '').trim(),
      pass,
      from: parsedFrom.email,
      fromName,
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
    trialAddOnSlugs?: string[] | null;
    trialEndPolicy?: TrialEndPolicy;
  }): Promise<TrialSettings> {
    const next: TrialSettings = {
      trialDays: input.trialDays ?? this.trial.trialDays,
      graceDays: input.graceDays ?? this.trial.graceDays,
      trialAddOnSlugs:
        input.trialAddOnSlugs !== undefined
          ? input.trialAddOnSlugs
          : this.trial.trialAddOnSlugs,
      trialEndPolicy: input.trialEndPolicy ?? this.trial.trialEndPolicy,
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
    if (
      next.trialAddOnSlugs !== null &&
      (!Array.isArray(next.trialAddOnSlugs) ||
        next.trialAddOnSlugs.some((slug) => typeof slug !== 'string'))
    ) {
      throw new BadRequestException(
        'trialAddOnSlugs must be null or an array of add-on slugs',
      );
    }
    if (!TRIAL_END_POLICIES.includes(next.trialEndPolicy)) {
      throw new BadRequestException(
        'trialEndPolicy must be grace_then_suspend or suspend_immediately',
      );
    }
    // Normalise: trim slugs, drop empties and duplicates (stable order).
    if (next.trialAddOnSlugs) {
      next.trialAddOnSlugs = [
        ...new Set(next.trialAddOnSlugs.map((slug) => slug.trim())),
      ].filter(Boolean);
    }
    await this.store('trial_defaults', next);
    this.trial = next;
    return this.getTrialDefaults();
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

  /**
   * Update the SaaS SMTP settings (smtp-balance-design.md §3). Partial:
   * omitted fields keep their stored value; an explicit null pricePerUnit
   * clears the rate (top-ups disabled until a rate is set again).
   * Changing the expiry setting never rewrites existing lots
   * (grandfathering, §5.2) — only lots granted after the change use it.
   */
  async updateSaasSmtp(input: {
    unit?: string;
    pricePerUnit?: number | null;
    freeAllowance?: number;
    lowBalanceThreshold?: number;
    expiry?: { mode?: string; days?: number; warnDays?: number };
  }): Promise<SaasSmtpSettings> {
    const current = this.saasSmtp;
    const unit = input.unit ?? current.unit;
    if (unit !== 'PER_EMAIL' && unit !== 'PER_1000') {
      throw new BadRequestException("unit must be 'PER_EMAIL' or 'PER_1000'");
    }
    const pricePerUnit =
      input.pricePerUnit !== undefined
        ? input.pricePerUnit
        : current.pricePerUnit;
    if (
      pricePerUnit !== null &&
      (typeof pricePerUnit !== 'number' ||
        !Number.isFinite(pricePerUnit) ||
        pricePerUnit < 0)
    ) {
      throw new BadRequestException(
        'pricePerUnit must be null or a number >= 0',
      );
    }
    const freeAllowance = input.freeAllowance ?? current.freeAllowance;
    if (
      !Number.isInteger(freeAllowance) ||
      freeAllowance < 0 ||
      freeAllowance > SAAS_SMTP_FREE_ALLOWANCE_MAX
    ) {
      throw new BadRequestException(
        `freeAllowance must be an integer between 0 and ${SAAS_SMTP_FREE_ALLOWANCE_MAX}`,
      );
    }
    const lowBalanceThreshold =
      input.lowBalanceThreshold ?? current.lowBalanceThreshold;
    if (!Number.isInteger(lowBalanceThreshold) || lowBalanceThreshold < 0) {
      throw new BadRequestException(
        'lowBalanceThreshold must be an integer >= 0',
      );
    }
    const expiryMode = input.expiry?.mode ?? current.expiry.mode;
    if (
      expiryMode !== 'NONE' &&
      expiryMode !== 'FIXED_DAYS' &&
      expiryMode !== 'END_OF_PERIOD'
    ) {
      throw new BadRequestException(
        "expiry.mode must be 'NONE', 'FIXED_DAYS' or 'END_OF_PERIOD'",
      );
    }
    const expiryDays = input.expiry?.days ?? current.expiry.days;
    if (!Number.isInteger(expiryDays) || expiryDays < 1) {
      throw new BadRequestException('expiry.days must be an integer >= 1');
    }
    const warnDays = input.expiry?.warnDays ?? current.expiry.warnDays;
    if (!Number.isInteger(warnDays) || warnDays < 0) {
      throw new BadRequestException('expiry.warnDays must be an integer >= 0');
    }
    const next: SaasSmtpSettings = {
      unit,
      pricePerUnit,
      freeAllowance,
      lowBalanceThreshold,
      expiry: { mode: expiryMode, days: expiryDays, warnDays },
    };
    await this.store('saas_smtp', next);
    this.saasSmtp = next;
    return this.getSaasSmtp();
  }

  /**
   * Update one platform's ad tracking config (CMS batch 2, item 21).
   * Partial: omitted fields keep their stored value. accessToken
   * omitted = keep the stored token; an empty string clears it.
   * `store()` encrypts the token at rest (same pattern as the SMTP
   * password); the returned public view never carries the token.
   */
  async updateAdTracking(
    platformId: string,
    input: {
      pixelId?: string;
      accessToken?: string;
      mode?: string;
      triggerStatus?: string;
      eventName?: string;
      enabled?: boolean;
    },
  ): Promise<AdPlatformSettingsPublic> {
    if (!isKnownAdPlatform(platformId)) {
      throw new BadRequestException(`Unknown ad platform: ${platformId}`);
    }
    const current =
      this.adTracking[platformId] ?? defaultAdPlatform(platformId);
    const pixelId = (input.pixelId ?? current.pixelId).trim();
    if (pixelId.length > 100) {
      throw new BadRequestException('pixelId must be at most 100 characters');
    }
    // Omit = keep the stored token; an explicit value replaces it
    // (empty clears). `current.accessToken` is already decrypted;
    // store() re-encrypts it, so a kept token is never double-encrypted.
    const accessToken =
      input.accessToken !== undefined
        ? input.accessToken.trim() || undefined
        : current.accessToken;
    if ((accessToken?.length ?? 0) > 500) {
      throw new BadRequestException(
        'accessToken must be at most 500 characters',
      );
    }
    const mode = input.mode ?? current.mode;
    if (mode !== 'instant' && mode !== 'validated') {
      throw new BadRequestException(
        "mode must be 'instant' or 'validated'",
      );
    }
    const triggerStatus = input.triggerStatus ?? current.triggerStatus;
    if (
      !(Object.values(LeadStatus) as string[]).includes(triggerStatus)
    ) {
      throw new BadRequestException(
        `triggerStatus must be a lead status (${Object.values(LeadStatus).join(', ')})`,
      );
    }
    const eventName =
      input.eventName !== undefined
        ? input.eventName.trim() ||
          getAdPlatform(platformId)?.defaultEventName ||
          'Lead'
        : current.eventName;
    if (eventName.length > 100) {
      throw new BadRequestException(
        'eventName must be at most 100 characters',
      );
    }
    const next: AdPlatformSettingsInternal = {
      pixelId,
      accessToken,
      mode,
      triggerStatus,
      eventName,
      enabled: input.enabled ?? current.enabled,
    };
    const stored = this.getAdTrackingInternal();
    stored[platformId] = next;
    await this.store('ad_tracking', stored);
    this.adTracking = stored;
    return this.getAdTracking()[platformId]!;
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
      const storedSlugs = Array.isArray(trial.trialAddOnSlugs)
        ? trial.trialAddOnSlugs.filter(
            (slug): slug is string =>
              typeof slug === 'string' && slug.trim().length > 0,
          )
        : null;
      const storedPolicy =
        trial.trialEndPolicy === 'suspend_immediately'
          ? 'suspend_immediately'
          : 'grace_then_suspend';
      this.trial = {
        trialDays: asNumber(trial.trialDays, DEFAULT_TRIAL_DAYS),
        graceDays: asNumber(trial.graceDays, DEFAULT_GRACE_DAYS),
        trialAddOnSlugs: storedSlugs,
        trialEndPolicy: storedPolicy,
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
    await this.loadSaasSmtp();
    await this.loadAdTracking();
  }

  /**
   * SaaS SMTP settings: the stored PlatformSetting, defensively parsed
   * (a malformed row falls back to defaults field by field, never
   * crashing the boot). A missing row means the backfill has not run —
   * defaults apply (top-ups disabled: pricePerUnit null).
   */
  private async loadSaasSmtp(): Promise<void> {
    const stored = await this.readStored('saas_smtp');
    if (!isRecord(stored)) return;
    const expiry = isRecord(stored.expiry) ? stored.expiry : {};
    const mode = expiry.mode;
    const next: SaasSmtpSettings = {
      unit: stored.unit === 'PER_1000' ? 'PER_1000' : 'PER_EMAIL',
      pricePerUnit:
        typeof stored.pricePerUnit === 'number' &&
        Number.isFinite(stored.pricePerUnit) &&
        stored.pricePerUnit >= 0
          ? stored.pricePerUnit
          : null,
      freeAllowance: Math.min(
        Math.max(0, Math.floor(asNumber(stored.freeAllowance, 10))),
        SAAS_SMTP_FREE_ALLOWANCE_MAX,
      ),
      lowBalanceThreshold: Math.max(
        0,
        Math.floor(asNumber(stored.lowBalanceThreshold, 10)),
      ),
      expiry: {
        mode:
          mode === 'FIXED_DAYS' || mode === 'END_OF_PERIOD'
            ? mode
            : 'NONE',
        days: Math.max(1, Math.floor(asNumber(expiry.days, 90))),
        warnDays: Math.max(0, Math.floor(asNumber(expiry.warnDays, 7))),
      },
    };
    this.saasSmtp = next;
  }

  /**
   * Ad tracking settings: the stored PlatformSetting, defensively
   * parsed per platform (a malformed row falls back to defaults field
   * by field, never crashing the boot). A missing row means no ad
   * platform is configured — dispatch stays a no-op.
   */
  private async loadAdTracking(): Promise<void> {
    const stored = await this.readAdTrackingStored();
    const next = defaultAdTracking();
    if (isRecord(stored)) {
      for (const platform of AD_PLATFORMS) {
        const row = stored[platform.id];
        if (!isRecord(row)) continue;
        next[platform.id] = parseAdPlatformRow(platform.id, row);
      }
    }
    this.adTracking = next;
  }

  /**
   * Read the stored ad_tracking setting with each platform's
   * `accessToken` decrypted when it is ciphertext (same pattern as
   * readSmtpStored, per platform). A legacy PLAINTEXT token is lazily
   * migrated; an undecryptable token (missing/rotated key) fails
   * closed for that platform only — the token is dropped, the
   * platform reads as unconfigured, and the operator gets a loud log
   * line. Other platforms are unaffected.
   */
  private async readAdTrackingStored(): Promise<unknown> {
    const stored = await this.readStored('ad_tracking');
    if (!isRecord(stored)) return stored;
    let migrated = false;
    const next: Record<string, unknown> = { ...stored };
    for (const platform of AD_PLATFORMS) {
      const row = stored[platform.id];
      if (!isRecord(row)) continue;
      const token = asString(row.accessToken);
      if (!token) continue;
      if (EncryptionService.isEncrypted(token)) {
        try {
          next[platform.id] = {
            ...row,
            accessToken: this.encryption.decrypt(token),
          };
        } catch (err) {
          this.logger.error(
            `Stored ${platform.id} ad token cannot be decrypted (APP_ENCRYPTION_KEY missing or rotated); ${platform.id} dispatch is disabled until the token is re-entered: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          next[platform.id] = { ...row, accessToken: undefined };
        }
      } else if (this.encryption.isConfigured()) {
        // Legacy plaintext row: migrate it now (no-op without a key).
        migrated = true;
      }
    }
    if (migrated) {
      try {
        await this.store('ad_tracking', stored);
        this.logger.log(
          'Migrated legacy plaintext ad token(s) to encrypted storage',
        );
      } catch (err) {
        this.logger.warn(
          `Ad token re-encryption failed; using the plaintext row this boot: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return next;
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
      const envFrom = splitFrom(
        process.env.SMTP_FROM ?? process.env.PLATFORM_MAIL_FROM ?? '',
      );
      this.smtp = {
        host: envHost,
        port: Number(process.env.SMTP_PORT ?? 587) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        user: (process.env.SMTP_USER ?? '').trim(),
        pass: process.env.SMTP_PASS || undefined,
        from: envFrom.email,
        fromName: envFrom.name,
        configured: true,
        source: 'env',
      };
      return;
    }
    const stored = await this.readSmtpStored();
    if (isRecord(stored) && asString(stored.host)) {
      // Legacy rows stored "Name <email>" in `from` with no fromName —
      // parse it on read so the console shows two clean fields.
      const storedFrom = splitFrom(asString(stored.from));
      this.smtp = {
        host: asString(stored.host),
        port: asNumber(stored.port, 587),
        secure: asBoolean(stored.secure, false),
        user: asString(stored.user),
        pass: asString(stored.pass) || undefined,
        from: storedFrom.email,
        fromName: asString(stored.fromName) || storedFrom.name,
        configured: true,
        source: 'setting',
      };
      return;
    }
    const fallbackFrom = splitFrom(process.env.PLATFORM_MAIL_FROM ?? '');
    this.smtp = {
      host: '',
      port: 587,
      secure: false,
      user: '',
      pass: undefined,
      from: fallbackFrom.email,
      fromName: fallbackFrom.name,
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
    if (config.fromName.length > SMTP_FROM_NAME_MAX_LENGTH) {
      throw new BadRequestException(
        `SMTP sender name must be at most ${SMTP_FROM_NAME_MAX_LENGTH} characters`,
      );
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
    // Ad tracking access tokens are encrypted the same way, per
    // platform (the ad_tracking row is a record keyed by platform id).
    if (key === 'ad_tracking' && isRecord(value)) {
      const next: Record<string, unknown> = {};
      for (const [platformId, cfg] of Object.entries(value)) {
        if (!isRecord(cfg)) {
          next[platformId] = cfg;
          continue;
        }
        const token = asString(cfg.accessToken);
        next[platformId] =
          token && !EncryptionService.isEncrypted(token)
            ? { ...cfg, accessToken: this.encryption.encrypt(token) }
            : cfg;
      }
      value = next;
    }
    await this.prisma.platformSetting.upsert({
      where: { key },
      update: { value: value as any },
      create: { key, value: value as any },
    });
  }
}
