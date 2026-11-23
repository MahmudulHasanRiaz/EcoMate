/**
 * Stores service — central-commerce §8.10 + §10 (P1 foundation).
 *
 * Owns: connect / reconnect / disconnect with duplicate protection,
 * write-only credential rotation (AES-256-GCM, masked reads — the
 * `MarketingConnection` pattern), NATIVE provisioning plus the throwing
 * guard (BR-20), and the health probe that populates the §12 state
 * vocabulary. Reads never return secrets (allowlist sanitize).
 *
 * Disconnect never deletes: identity, credential rows, mappings, history
 * and ownership state are retained; status flips to DISCONNECTED and the
 * store's queues stop (queues land in P4+).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { EncryptionService } from '../common/utils/encryption';
import { getTenantContext, runWithTenant } from '../tenancy/tenant-context';
import { TenantLimitsService } from '../entitlements/tenant-limits.service';
import { ExternalStoreResolver } from '../external-stores/external-store-resolver.service';
import {
  PlatformBindingClient,
  StoreAlreadyBoundError,
} from '../external-stores/platform-binding.client';
import { identityFingerprint, normaliseDomain } from './store-identity';
import { NATIVE_STORE_KIND, ProviderRegistryService } from './providers/provider-registry.service';
import type {
  EnsureWebhooksOptions,
  StoreWithSecrets,
  TestConnectionResult,
  WebhookRegistrationResult,
} from './providers/provider.contract';
import { resolveWebhookCallbackBase } from './webhooks/webhook-callback-base';
import { SyncRunService } from './sync/sync-run.service';
import {
  ProviderError,
  ProviderErrorCategory,
} from '../marketing/ad-provider.adapter';
import {
  isInstallTimestampFresh,
  verifyShopifyInstallHmac,
} from './providers/webhook-crypto';
import {
  CreateStoreDto,
  RotateStoreCredentialsDto,
  TestConnectionDto,
  UpdateStoreDto,
} from './dto/stores.dto';

function sanitizeStore(store: any) {
  const { ...rest } = store ?? {};
  delete (rest as any).credentials;
  delete (rest as any).credentialsEnc;
  return rest;
}

/** Sync-issue codes for the webhook lifecycle (G-01/G-05/G-06). */
export const WEBHOOK_ENSURE_FAILED_CODE = 'WEBHOOK_ENSURE_FAILED';
export const WEBHOOK_HEALED_CODE = 'WEBHOOK_HEALED';
/**
 * Settings-JSON key carrying the last webhook-ensure outcome — surfaced by
 * detail() with no schema change. The value is a WebhookEnsureOutcome
 * (topics + counts + error, never secrets).
 */
export const WEBHOOK_ENSURE_SETTINGS_KEY = 'webhookEnsure';

/** Outcome of one webhook-ensure attempt (persisted + returned inline). */
export interface WebhookEnsureOutcome {
  status: 'ok' | 'failed';
  topics: string[];
  created: string[];
  recreated: string[];
  deleted: number;
  error?: string;
  at: string;
}

@Injectable()
export class StoresService {
  private readonly logger = new Logger(StoresService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private registry: ProviderRegistryService,
    // SaaS §3.4/§5.2 — trailing @Optional so unit specs constructing the
    // service manually (3 args) keep working; production always wires
    // them via StoresModule (ExternalStoresModule + EntitlementsModule).
    // Without them the connect flow degrades to the upstream local-only
    // behaviour (specs) — in production they are always present.
    @Optional() private readonly resolver?: ExternalStoreResolver,
    @Optional() private readonly bindingClient?: PlatformBindingClient,
    @Optional() private readonly limits?: TenantLimitsService,
    // Webhook lifecycle (G-01): issue rows for failed ensures. Trailing
    // @Optional like the rest — specs constructing the service manually
    // (3 args) keep working; without it, failures are log-only.
    @Optional() private readonly syncRuns?: SyncRunService,
  ) {}

  // ── Reads (never secrets) ──────────────────────────────────────────

  async list() {
    let stores = await this.prisma.store.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { credentials: true, healthChecks: true } } },
    });
    // SaaS §8.2.7: lazy NATIVE ensure — a tenant with no NATIVE row gets
    // one on first list (the row is the native website's identity; every
    // tenant has exactly one). Idempotent; a concurrent list racing the
    // create is absorbed by ensureNativeStore's P2002 guard.
    if (!stores.some((s) => (s as any).kind === NATIVE_STORE_KIND)) {
      await this.ensureNativeStore();
      stores = await this.prisma.store.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { credentials: true, healthChecks: true } } },
      });
    }
    return stores.map(sanitizeStore);
  }

  async detail(id: string) {
    const store = await this.requireStore(id);
    return sanitizeStore(store);
  }

  // ── Connect (P1: §8.10 duplicate protection + 409 reconnect payload) ──

  /**
   * SaaS §3.4 connect flow: local duplicate check (same tenant → the
   * 409 reconnect payload) → plan limit check (`external_stores`,
   * absent limit = unlimited) → pre-generated storeId → platform claim
   * (PENDING, the GLOBAL duplicate guard — RLS cannot see other
   * tenants' rows) → tenant insert → binding ACTIVE + resolver cache
   * warm. On any failure after the claim, the claim is released (a
   * PENDING binding also expires after 10 minutes on the platform).
   * A cross-tenant collision surfaces as a generic 409 with no
   * identifying data (STORE_ALREADY_BOUND).
   */
  async connect(dto: CreateStoreDto, actorId?: string) {
    if (dto.kind === NATIVE_STORE_KIND) {
      throw new BadRequestException('NATIVE is provisioned, never connected (BR-20)');
    }
    const domainNormalised = normaliseDomain(dto.domain);
    const fingerprint = identityFingerprint({
      kind: dto.kind,
      providerStoreId: dto.providerStoreId,
      domain: domainNormalised,
    });

    const existing = await this.prisma.store.findFirst({
      where: {
        OR: [{ identityFingerprint: fingerprint }, { kind: dto.kind as any, domainNormalised }],
      },
    });
    if (existing) {
      // §8.10: reconnect onto the same row — never a duplicate row.
      throw new ConflictException({
        message: 'This store is already registered. Reconnect to the existing store.',
        code: 'STORE_ALREADY_EXISTS',
        storeId: existing.id,
        storeName: existing.name,
        storeStatus: existing.status,
      });
    }

    // §5.2: plan limit BEFORE the platform claim (a refused connect must
    // not leave a PENDING binding behind). Absent limit = unlimited.
    await this.limits?.assertWithinLimit('external_stores');

    const tenantId = getTenantContext()?.tenantId;
    const storeId = randomUUID();
    const provider = dto.kind as 'WOOCOMMERCE' | 'SHOPIFY' | 'CUSTOM';
    let claimed = false;
    if (this.bindingClient && tenantId) {
      try {
        await this.bindingClient.claim({
          storeId,
          tenantId,
          provider,
          providerStoreId: dto.providerStoreId,
          domainNormalised: domainNormalised ?? undefined,
          identityFingerprint: fingerprint,
        });
        claimed = true;
      } catch (err) {
        if (err instanceof StoreAlreadyBoundError) {
          throw new ConflictException({
            message: 'This store is already registered.',
            code: 'STORE_ALREADY_BOUND',
          });
        }
        throw err;
      }
    }

    let store: any;
    try {
      store = await this.prisma.store.create({
        data: {
          id: storeId,
          kind: dto.kind as any,
          name: dto.name,
          domainNormalised,
          identityFingerprint: fingerprint,
          providerStoreId: dto.providerStoreId,
          status: 'PENDING',
          healthState: 'DISCONNECTED',
        },
      });
    } catch (err: any) {
      if (claimed) {
        await this.bindingClient?.release(storeId).catch(() => undefined);
      }
      // P2002 race: a concurrent connect for the same identity landed
      // between the check and the insert — answer with the reconnect
      // payload instead of a raw unique error.
      if (err?.code === 'P2002') {
        const raced = await this.prisma.store.findFirst({
          where: {
            OR: [{ identityFingerprint: fingerprint }, { kind: dto.kind as any, domainNormalised }],
          },
        });
        if (raced) {
          throw new ConflictException({
            message: 'This store is already registered. Reconnect to the existing store.',
            code: 'STORE_ALREADY_EXISTS',
            storeId: raced.id,
            storeName: raced.name,
            storeStatus: raced.status,
          });
        }
        // D-2: RLS hides a colliding row owned by ANOTHER tenant, so
        // `raced` is null — but the P2002 proves the identity exists
        // somewhere. That is exactly the bound case: answer with the
        // generic bound 409, never the raw Prisma message.
        throw new ConflictException({
          message: 'This store is already registered.',
          code: 'STORE_ALREADY_BOUND',
        });
      }
      throw err;
    }

    if (claimed && this.bindingClient) {
      // Connect success → binding ACTIVE. Best-effort but LOUD on
      // failure: a binding left PENDING expires after 10 minutes and
      // the store's webhooks start 401ing.
      try {
        await this.bindingClient.updateStatus(storeId, 'ACTIVE');
      } catch (err) {
        this.logger.error(
          `binding status update failed for store ${storeId} (binding stays PENDING, expires in 10 min): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await this.resolver?.cacheBinding(storeId, tenantId as string, {
        provider,
        domain: domainNormalised ?? undefined,
      });
    }

    if (dto.credentials && Object.keys(dto.credentials).length > 0) {
      await this.storeCredentialRow(store.id, dto.credentials, actorId);
    }

    // Webhook lifecycle (G-01/G-02): webhooks auto-create on connect, with
    // a server-generated secret for stores that have none. Best-effort —
    // an ensure failure must NEVER fail the connect (logged + issue row +
    // outcome persisted into settings.webhookEnsure, surfaced below).
    const webhookOutcome = await this.ensureStoreWebhooksBestEffort(store.id, {
      ensureSecret: true,
    });

    this.logger.log(`Store connected: ${store.id} (${store.kind})`);
    const settings = {
      ...((store.settings as Record<string, unknown> | null) ?? {}),
      [WEBHOOK_ENSURE_SETTINGS_KEY]: webhookOutcome,
    };
    return sanitizeStore({ ...store, settings });
  }

  // ── Update (name + settings only; no delete-mode field — BR-09) ──────

  async update(id: string, dto: UpdateStoreDto) {
    const store = await this.requireStore(id);
    if (store.kind === NATIVE_STORE_KIND && dto.autoSyncEnabled !== undefined) {
      throw new BadRequestException('NATIVE store has no sync settings (BR-20)');
    }
    // P9 wizard "Sync configuration" (additive): syncScope/initialSyncPolicy
    // merge into the existing settings JSON — never a wholesale replace of
    // unrelated keys (e.g. baseUrl/mediaProbeUrl written by other flows).
    const prevSettings = ((store.settings as Record<string, unknown> | null) ?? {});
    const wantsSyncConfig =
      dto.settings !== undefined ||
      dto.syncScope !== undefined ||
      dto.initialSyncPolicy !== undefined;
    const nextSettings: Record<string, unknown> | undefined = wantsSyncConfig
      ? {
          ...prevSettings,
          ...((dto.settings as Record<string, unknown> | undefined) ?? {}),
          ...(dto.syncScope !== undefined
            ? {
                syncScope: {
                  ...((prevSettings.syncScope as Record<string, unknown> | undefined) ?? {}),
                  ...dto.syncScope,
                },
              }
            : {}),
          ...(dto.initialSyncPolicy !== undefined
            ? { initialSyncPolicy: dto.initialSyncPolicy }
            : dto.syncScope !== undefined && (prevSettings as Record<string, unknown>).initialSyncPolicy === undefined
              ? { initialSyncPolicy: 'adopt_existing' }
              : {}),
        }
      : undefined;
    const updated = await this.prisma.store.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(nextSettings !== undefined
          ? { settings: nextSettings as unknown as Prisma.InputJsonValue }
          : {}),
        ...(dto.autoSyncEnabled !== undefined ? { autoSyncEnabled: dto.autoSyncEnabled } : {}),
      },
    });
    return sanitizeStore(updated);
  }

  // ── Credentials: write-only rotation ────────────────────────────────

  async rotateCredentials(id: string, dto: RotateStoreCredentialsDto, actorId?: string) {
    const store = await this.requireStore(id);
    // A rotation that omits `webhookSecret` (the Woo reconnect dialog has
    // no such field) must NOT drop the stored secret — losing it orphans
    // every registered webhook. Carry it forward (or generate one for a
    // Woo store that never had one).
    const { credentials } = await this.preservedCredentials(
      id,
      store.kind as string,
      dto.credentials,
    );
    const row = await this.storeCredentialRow(id, credentials, actorId);
    // Write-only: acknowledge rotation, never echo the payload.
    return { storeId: id, rotatedAt: row.rotatedAt, keyFingerprint: row.keyFingerprint };
  }

  /**
   * Webhook-secret preservation across credential rotations (G-02): an
   * explicitly supplied secret always wins; otherwise the stored secret
   * carries forward; a Woo store with no secret anywhere gets one
   * generated. `secretChanged` is true when the effective secret differs
   * from the previously stored one (reconnect force-recreates hooks then).
   * The old blob is read best-effort — a corrupt/unreadable blob must not
   * fail the rotation (rotation is the recovery for it).
   */
  private async preservedCredentials(
    storeId: string,
    kind: string,
    incoming: Record<string, unknown>,
  ): Promise<{ credentials: Record<string, unknown>; secretChanged: boolean }> {
    const incomingSecret = String((incoming as any).webhookSecret ?? '');
    let previous = '';
    try {
      const current = (await this.loadSecrets(storeId)) ?? {};
      previous = String((current as any).webhookSecret ?? '');
    } catch {
      previous = '';
    }
    if (incomingSecret) {
      return { credentials: incoming, secretChanged: incomingSecret !== previous };
    }
    if (previous) {
      return { credentials: { ...incoming, webhookSecret: previous }, secretChanged: false };
    }
    if (kind === 'WOOCOMMERCE') {
      return {
        credentials: { ...incoming, webhookSecret: randomBytes(32).toString('hex') },
        secretChanged: true,
      };
    }
    return { credentials: incoming, secretChanged: false };
  }

  private async storeCredentialRow(storeId: string, credentials: Record<string, unknown>, actorId?: string) {
    return this.prisma.storeCredential.create({
      data: {
        storeId,
        credentialsEnc: this.encryption.encrypt(JSON.stringify(credentials)),
        // SaaS §3.6: the key label follows the canonical key name
        // (APP_ENCRYPTION_KEY; LICENSE_ENCRYPTION_KEY is the legacy
        // fallback the EncryptionService still honours).
        keyFingerprint: process.env.APP_ENCRYPTION_KEY
          ? 'app-key'
          : process.env.LICENSE_ENCRYPTION_KEY
            ? 'license-key'
            : 'default-key',
        rotatedById: actorId,
      },
    });
  }

  /** Latest credential payload, decrypted. Server-side only — never returned by reads. */
  async loadSecrets(storeId: string): Promise<Record<string, unknown> | null> {
    const row = await this.prisma.storeCredential.findFirst({
      where: { storeId },
      orderBy: { rotatedAt: 'desc' },
    });
    if (!row) return null;
    try {
      return JSON.parse(this.encryption.decrypt(row.credentialsEnc));
    } catch {
      throw new BadRequestException('Stored credentials cannot be decrypted');
    }
  }

  // ── Webhook lifecycle (G-01–G-07) ───────────────────────────────────

  /**
   * Webhook secret agreement (G-02/G-03) — per-provider matrix:
   * - WOOCOMMERCE: the secret is ours to choose (Woo signs with whatever
   *   `secret` the create payload carries; verifyWebhook checks
   *   `secrets.webhookSecret`). Generate `randomBytes(32).hex` when the
   *   store has none and persist it encrypted via the existing
   *   credential-row path, merged into the latest blob — never a bare row
   *   that would drop the connection credentials.
   * - CUSTOM: the bridge signs with a shared secret configured out-of-band
   *   on the bridge; EcoMate never generates one (a secret the bridge was
   *   never told is unverifiable by design).
   * - SHOPIFY: HMAC uses the app secret (`webhookSecret ?? clientSecret`)
   *   — generating a webhookSecret would switch verification to a key
   *   Shopify never signs with and break every delivery. Never generate.
   * Returns true when a secret was newly generated + stored.
   */
  async ensureWebhookSecret(storeId: string): Promise<boolean> {
    const store = await this.requireStore(storeId);
    return this.writeWebhookSecret(storeId, store.kind as string, false);
  }

  /** Rotate the webhook secret (heal-on-signature-failure, J-01). WooCommerce only; no-op otherwise. */
  async rotateWebhookSecret(storeId: string): Promise<boolean> {
    const store = await this.requireStore(storeId);
    return this.writeWebhookSecret(storeId, store.kind as string, true);
  }

  private async writeWebhookSecret(storeId: string, kind: string, rotate: boolean): Promise<boolean> {
    if (kind !== 'WOOCOMMERCE') return false;
    const current = (await this.loadSecrets(storeId)) ?? {};
    if (!rotate && String((current as any).webhookSecret ?? '')) return false;
    await this.storeCredentialRow(storeId, {
      ...current,
      webhookSecret: randomBytes(32).toString('hex'),
    });
    return true;
  }

  /**
   * Ensure this store's provider webhooks exist, point at the intake route
   * and are active (delegates to the provider's ensureWebhooks, which heals
   * duplicates/disabled/stale hooks). Throws on failure — callers that must
   * not fail use ensureStoreWebhooksBestEffort.
   *
   * `ensureSecret`: generate + persist a webhook secret first when the
   * store has none (WooCommerce only). Default false: a pure ensure never
   * writes a credential row. Every production ensure path passes true
   * (connect, testConnection, heal, health sweep, manual endpoint) —
   * a pre-lifecycle store with no secret gets one backfilled, never
   * regenerated (reconnect guarantees the secret separately, via
   * preservedCredentials).
   */
  async ensureStoreWebhooks(
    storeId: string,
    opts?: EnsureWebhooksOptions & { ensureSecret?: boolean },
  ): Promise<WebhookRegistrationResult> {
    const store = await this.requireStore(storeId);
    if (store.kind === NATIVE_STORE_KIND) {
      throw new BadRequestException('NATIVE store has no provider webhooks (BR-20)');
    }
    if (opts?.ensureSecret) {
      await this.ensureWebhookSecret(storeId);
    }
    const base = resolveWebhookCallbackBase();
    const provider = this.registry.providerFor({ kind: store.kind });
    // Re-read the secrets AFTER the secret ensure: a concurrent ensure
    // racing the secret write must still register with the LATEST secret
    // (the winner's), never a stale in-memory copy.
    const full = await this.storeWithSecrets(storeId);
    return provider.ensureWebhooks(full, base, { forceRecreate: opts?.forceRecreate });
  }

  /**
   * Best-effort wrapper: an ensure failure NEVER throws — it is logged, an
   * issue row is recorded (the existing StoreSyncIssue mechanism), and the
   * outcome is persisted into settings.webhookEnsure so store detail
   * surfaces it. Returns the outcome for callers that want it inline.
   */
  async ensureStoreWebhooksBestEffort(
    storeId: string,
    opts?: EnsureWebhooksOptions & { ensureSecret?: boolean },
  ): Promise<WebhookEnsureOutcome> {
    let outcome: WebhookEnsureOutcome;
    try {
      const result = await this.ensureStoreWebhooks(storeId, opts);
      outcome = {
        status: result.ok ? 'ok' : 'failed',
        topics: result.topics,
        created: result.created ?? [],
        recreated: result.recreated ?? [],
        deleted: result.deleted ?? 0,
        ...(result.reason ? { error: result.reason } : {}),
        at: new Date().toISOString(),
      };
      if (!result.ok) {
        this.logger.warn(`webhook ensure failed for store ${storeId}: ${result.reason ?? 'unknown'}`);
      } else {
        this.logger.log(
          `webhook ensure ok for store ${storeId} (created ${outcome.created.length}, recreated ${outcome.recreated.length}, deleted ${outcome.deleted})`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`webhook ensure failed for store ${storeId}: ${message}`);
      outcome = {
        status: 'failed',
        topics: [],
        created: [],
        recreated: [],
        deleted: 0,
        error: message,
        at: new Date().toISOString(),
      };
    }
    if (outcome.status === 'failed') {
      await this.recordWebhookIssue(storeId, outcome.error ?? 'webhook ensure failed');
    }
    await this.persistWebhookEnsureOutcome(storeId, outcome);
    return outcome;
  }

  /** Best-effort issue row for a failed webhook ensure (existing SyncIssue mechanism). */
  private async recordWebhookIssue(storeId: string, message: string): Promise<void> {
    if (!this.syncRuns) return;
    try {
      await this.syncRuns.upsertIssue({
        storeId,
        code: WEBHOOK_ENSURE_FAILED_CODE,
        objectType: 'ORDER',
        objectKey: 'webhook-ensure',
        message: `Webhook registration failed: ${message}`.slice(0, 500),
      });
    } catch (err) {
      this.logger.warn(
        `webhook issue row failed for store ${storeId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Persist the last ensure outcome into settings.webhookEnsure (surfaced by detail()). */
  private async persistWebhookEnsureOutcome(storeId: string, outcome: WebhookEnsureOutcome): Promise<void> {
    try {
      const store = await this.requireStore(storeId);
      const prevSettings = ((store.settings as Record<string, unknown> | null) ?? {});
      await this.prisma.store.update({
        where: { id: storeId },
        data: {
          settings: { ...prevSettings, [WEBHOOK_ENSURE_SETTINGS_KEY]: outcome } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `webhook outcome persist failed for store ${storeId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── test-connection / health probe (§12 vocabulary) ─────────────────

  async testConnection(id: string, dto?: TestConnectionDto) {
    const store = await this.requireStore(id);
    const provider = this.registry.providerFor({ kind: store.kind });
    const secrets =
      dto?.credentials ?? ((await this.loadSecrets(id)) as Record<string, unknown> | null) ?? {};
    // Same shop fallback as storeWithSecrets (reconnect blobs omit `shop`).
    if (!secrets.shop && (store as any).domainNormalised) {
      secrets.shop = (store as any).domainNormalised;
    }
    let result: TestConnectionResult;
    try {
      result = await provider.testConnection({
        id: store.id,
        kind: store.kind,
        settings: (store.settings as Record<string, unknown> | null) ?? {},
        secrets,
      });
    } catch (err) {
      // Adapter-refused connections (bad credentials shape, org mismatch,
      // app not installed) surface as 400 with the actionable message.
      // Messages never carry secrets (stores-secret-leak.spec.ts).
      if (
        err instanceof ProviderError &&
        err.category === ProviderErrorCategory.INVALID_REQUEST
      ) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    await this.recordHealthCheck(id, {
      state: result.authenticated ? 'HEALTHY' : result.reachable ? 'ATTENTION_REQUIRED' : 'ERROR',
      reason: result.authenticated ? 'ok' : result.reachable ? 'auth_error' : 'store_down',
      reachable: result.reachable,
      authenticated: result.authenticated,
      permissionsOk: result.permissionsOk,
      mediaReachable: result.mediaReachable,
      detail: {
        providerStoreId: result.providerStoreId,
        plugin: result.plugin,
        capabilities: result.capabilities,
      },
    });
    if (result.providerStoreId && !store.providerStoreId) {
      await this.prisma.store.update({
        where: { id },
        data: { providerStoreId: result.providerStoreId },
      });
    }
    // Verified connection completes the wizard: PENDING → CONNECTED on the
    // first authenticated probe. DISCONNECTED is untouched (reconnect flows
    // through PENDING first); health vocabulary stays in healthState.
    if (result.authenticated && (store as any).status === 'PENDING') {
      await this.prisma.store.update({
        where: { id },
        data: { status: 'CONNECTED' as any },
      });
    }
    // Webhook lifecycle (G-01): a successful probe against the STORED
    // credentials auto-creates/heals the webhooks. Best-effort — never
    // fails the probe. The ensure BACKFILLS a missing secret
    // (ensureSecret: true): a store connected before the lifecycle work
    // has no secret, and without the backfill its ensure fails loudly
    // forever (WEBHOOK_ENSURE_FAILED) while Woo's webhook list stays
    // empty. The backfill only writes when no secret exists — an existing
    // secret is never regenerated (that would break live signatures).
    // Probes with override credentials (a non-empty dto.credentials) skip
    // the ensure — the ensure runs against stored credentials, and testing
    // a not-yet-saved set must have no side effects.
    const hasCredentialOverride =
      dto?.credentials !== undefined && Object.keys(dto.credentials).length > 0;
    if (result.authenticated && !hasCredentialOverride) {
      await this.ensureStoreWebhooksBestEffort(id, { ensureSecret: true });
    }
    return result;
  }

  async health(id: string) {
    await this.requireStore(id);
    return this.prisma.storeHealthCheck.findFirst({
      where: { storeId: id },
      orderBy: { checkedAt: 'desc' },
    });
  }

  // ── Reconnect / disconnect (§8.10: identity + history retained) ─────

  async reconnect(id: string, dto: RotateStoreCredentialsDto, actorId?: string) {
    const store = await this.requireStore(id);
    if (store.kind === NATIVE_STORE_KIND) {
      throw new BadRequestException('NATIVE store cannot be reconnected (BR-20)');
    }
    const { credentials, secretChanged } = await this.preservedCredentials(
      id,
      store.kind as string,
      dto.credentials,
    );
    await this.storeCredentialRow(id, credentials, actorId);
    const updated = await this.prisma.store.update({
      where: { id },
      data: { status: 'PENDING', lastError: null },
    });
    // D9: the retained binding returns to ACTIVE (reconnect reuses it).
    // Best-effort: intake re-checks the tenant row status, so a failed
    // update only delays webhook resolution until the operator retries.
    if (this.bindingClient) {
      try {
        await this.bindingClient.updateStatus(id, 'ACTIVE');
      } catch (err) {
        this.logger.error(
          `binding re-activation failed for store ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    const tenantId = getTenantContext()?.tenantId;
    if (tenantId) {
      await this.resolver?.cacheBinding(id, tenantId, {
        provider: (store as any).kind,
        domain: (store as any).domainNormalised,
      }).catch(() => undefined);
    }
    // If rotation minted a NEW webhook secret (none existed, or the
    // operator supplied a different one), the hooks registered under the
    // old secret can no longer verify — force-recreate them under the new
    // secret now instead of waiting for the next probe. Best-effort, never
    // fails the reconnect. When the secret carried forward unchanged, the
    // next testConnection ensure covers healing.
    if (secretChanged) {
      await this.ensureStoreWebhooksBestEffort(id, { forceRecreate: true });
    }
    this.logger.log(`Store reconnect started: ${id}`);
    return sanitizeStore(updated);
  }

  async disconnect(id: string) {
    const store = await this.requireStore(id);
    if (store.kind === NATIVE_STORE_KIND) {
      throw new BadRequestException('NATIVE store cannot be disconnected (BR-20)');
    }
    // Retains identity, credential rows, mappings, history, ownership state.
    const updated = await this.prisma.store.update({
      where: { id },
      data: { status: 'DISCONNECTED', healthState: 'DISCONNECTED' },
    });
    await this.recordHealthCheck(id, {
      state: 'DISCONNECTED',
      reason: 'disabled',
      reachable: false,
      authenticated: false,
      permissionsOk: false,
    });
    // D9: the platform binding is RETAINED — status flips to DISCONNECTED,
    // never released (reconnect reuses it; only tenant purge or operator
    // force-unbind removes it). Best-effort: intake re-checks the tenant
    // row status, so webhooks 401 even if this call fails.
    if (this.bindingClient) {
      try {
        await this.bindingClient.updateStatus(id, 'DISCONNECTED');
      } catch (err) {
        this.logger.error(
          `binding disconnect failed for store ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    await this.resolver?.invalidate(id, {
      provider: (store as any).kind,
      domain: (store as any).domainNormalised,
    }).catch(() => undefined);
    this.logger.log(`Store disconnected: ${id} (rows retained)`);
    return sanitizeStore(updated);
  }

  /**
   * Force-unbind support (Phase 9 §8.2.2, ruling D9): releases the store's
   * identity so another tenant may claim it. Clears ONLY the two
   * globally-unique identity columns (both nullable — no migration) and
   * flips status to DISCONNECTED; mappings, sync runs, credentials and
   * audit history are preserved on the row. Called from the
   * platform-internal endpoint with the tenant context set by the
   * controller (RLS scopes the update to that tenant's row). NATIVE rows
   * are never touched (BR-20). Idempotent: re-releasing an already
   * released row still matches and reports released:true, so a retried
   * force-unbind succeeds.
   */
  async releaseIdentity(storeId: string): Promise<{ released: boolean; storeId: string }> {
    const updated = await this.prisma.store.updateMany({
      where: { id: storeId, kind: { not: 'NATIVE' } },
      data: {
        identityFingerprint: null,
        domainNormalised: null,
        status: 'DISCONNECTED',
      },
    });
    if (updated.count > 0) {
      this.logger.log(`Store identity released (force-unbind): ${storeId}`);
    }
    return { released: updated.count > 0, storeId };
  }

  // ── NATIVE provisioning (BR-20) ─────────────────────────────────────

  async ensureNativeStore(): Promise<Record<string, unknown>> {
    const existing = await this.prisma.store.findFirst({
      where: { kind: 'NATIVE' as any },
    });
    if (existing) return sanitizeStore(existing);
    try {
      const created = await this.prisma.store.create({
        data: {
          kind: 'NATIVE' as any,
          name: 'Native Website',
          status: 'CONNECTED',
          healthState: 'HEALTHY',
        },
      });
      return sanitizeStore(created);
    } catch (err: any) {
      // Two concurrent first-lists racing the create: the loser re-reads
      // the winner's row instead of failing (NATIVE rows carry a NULL
      // domain, so the [kind, domain] unique cannot arbitrate — the
      // re-read is the guard).
      if (err?.code === 'P2002') {
        const raced = await this.prisma.store.findFirst({
          where: { kind: 'NATIVE' as any },
        });
        if (raced) return sanitizeStore(raced);
      }
      throw err;
    }
  }

  /** Build the provider-facing shape (secrets stay server-side). */
  async storeWithSecrets(id: string): Promise<StoreWithSecrets> {
    const store = await this.requireStore(id);
    const secrets = (await this.loadSecrets(id)) ?? {};
    // Shop identity lives on the store row (domainNormalised) — credential
    // rotations that omit `shop` (reconnect sends credentials only) must
    // not orphan the connection. Secrets win when present.
    if (!secrets.shop && (store as any).domainNormalised) {
      (secrets as any).shop = (store as any).domainNormalised;
    }
    return {
      id: store.id,
      kind: store.kind,
      settings: (store.settings as Record<string, unknown> | null) ?? {},
      secrets,
    };
  }

  // ── Internals ───────────────────────────────────────────────────────

  private async requireStore(id: string) {
    const store = await this.prisma.store.findUnique({ where: { id } });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  /**
   * Shopify app-install landing (App URL redirect after merchant install).
   * Resolves the `shop` query param to a connected SHOPIFY store, verifies
   * the HMAC with that store's secret, and returns safe display data.
   * Unknown shop → 404; bad/stale signature → 401 (both generic, no
   * secrets, no query echo).
   *
   * SaaS §3.3: the shop domain resolves to its tenant via the platform
   * binding FIRST (no tenant context exists on this public landing), and
   * the store lookup + HMAC run inside that tenant's context. An OAuth
   * `state` is never issued by us — a present state cannot be verified
   * against anything, so it fails closed (401) rather than being ignored.
   */
  async verifyInstallCallback(
    query: Record<string, string | string[] | undefined>,
  ): Promise<{ shop: string; storeId: string; storeName: string }> {
    const first = (v: string | string[] | undefined): string =>
      Array.isArray(v) ? v[0] ?? '' : v ?? '';
    const shop = first(query['shop']);
    const domain = normaliseDomain(shop);
    if (first(query['state'])) {
      throw new UnauthorizedException('Unauthorized');
    }
    // No shop domain → no store can match. (A null domain must never
    // reach the lookup: domainNormalised is nullable, so a null where
    // would match the first domain-less store.)
    if (!domain) throw new NotFoundException('Store not found');
    if (this.resolver) {
      const resolved = await this.resolver.resolveDomain('SHOPIFY', domain);
      if (!resolved) throw new NotFoundException('Store not found');
      return runWithTenant(
        { tenantId: resolved.tenantId, slug: 'install', status: 'ACTIVE' },
        () => this.verifyInstallInTenant(query, domain),
      );
    }
    // No resolver wired (unit specs): direct lookup (upstream behaviour).
    return this.verifyInstallInTenant(query, domain);
  }

  private async verifyInstallInTenant(
    query: Record<string, string | string[] | undefined>,
    domain: string,
  ): Promise<{ shop: string; storeId: string; storeName: string }> {
    const first = (v: string | string[] | undefined): string =>
      Array.isArray(v) ? v[0] ?? '' : v ?? '';
    const store = domain
      ? await this.prisma.store.findFirst({
          where: { kind: 'SHOPIFY' as any, domainNormalised: domain },
        })
      : null;
    if (!store) throw new NotFoundException('Store not found');
    const secrets = (await this.loadSecrets(store.id)) ?? {};
    const secret = String(
      (secrets as any).webhookSecret ?? (secrets as any).clientSecret ?? '',
    );
    if (
      !verifyShopifyInstallHmac(query, secret) ||
      !isInstallTimestampFresh(first(query['timestamp']))
    ) {
      throw new UnauthorizedException('Unauthorized');
    }
    return {
      shop: (store as any).domainNormalised ?? domain ?? '',
      storeId: store.id,
      storeName: (store as any).name ?? '',
    };
  }

  private async recordHealthCheck(
    storeId: string,
    check: {
      state: 'HEALTHY' | 'ATTENTION_REQUIRED' | 'ERROR' | 'DISCONNECTED';
      reason?: string;
      reachable: boolean;
      authenticated: boolean;
      permissionsOk: boolean;
      mediaReachable?: boolean;
      detail?: Record<string, unknown>;
    },
  ) {
    await this.prisma.storeHealthCheck.create({
      data: {
        storeId,
        state: check.state as any,
        reason: check.reason,
        reachable: check.reachable,
        authenticated: check.authenticated,
        permissionsOk: check.permissionsOk,
        mediaReachable: check.mediaReachable,
        detail: check.detail as unknown as Prisma.InputJsonValue,
      },
    });
    await this.prisma.store.update({
      where: { id: storeId },
      data: { healthState: check.state as any, lastHealthCheckAt: new Date() },
    });
  }
}
