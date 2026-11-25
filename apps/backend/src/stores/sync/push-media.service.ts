import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  SecureFetcher,
  defaultHttpTransport,
} from '../../images/secure-fetcher';
import { defaultDns } from '../../images/ip-classifier';
import { getTenantContext } from '../../tenancy/tenant-context';
import {
  canonicalTenantHost,
  readTenantDomainConfig,
} from '../../tenancy/tenant-host';
import { TenantRegistryService } from '../../tenancy/tenant-registry.service';
import { SyncRunService } from './sync-run.service';

/**
 * Outbound push media preparation (Phase 9 P0).
 *
 * The push path used to copy `product.images` verbatim into the
 * Woo/Shopify/bridge payloads. For default local-storage tenants those
 * values are RELATIVE (`/uploads/...`) — Woo/Shopify fetch the src
 * server-side, so they could never resolve them and remote products
 * were created WITHOUT images. Only R2-backed tenants (absolute URLs)
 * got images.
 *
 * This service is the single choke point that fixes that, before the
 * providers ever see the values:
 *
 *   1. Absolutize — a relative `/uploads/...` entry becomes
 *      `https://{tenant-canonical-host}/uploads/...`, where the host is
 *      the tenant's STABLE faah.net host (Boss decision D-1,
 *      2026-11-24) — never a custom domain, which can change.
 *      Absolute URLs pass through untouched. Unparseable entries are
 *      dropped with a MEDIA_URL_INVALID issue — never sent as a dead
 *      src.
 *   2. Reachability — every candidate URL is HEAD-checked through the
 *      DNS-pinned SecureFetcher (same core as the FIX B image work).
 *      A URL that fails is dropped with a MEDIA_UNREACHABLE issue and
 *      the product pushes imageless, with the reason on the record.
 *
 * The origin resolves WITHOUT an HTTP request (sync jobs have no
 * request): primary source is the TenantRegistryService (synced from
 * the platform every 60s) by tenant id; fallback is the ambient
 * tenant slug (HTTP requests carry the real slug; workers carry
 * job.data.tenantSlug). If no slug is resolvable anywhere, relative
 * entries are dropped with a MEDIA_ORIGIN_UNRESOLVED issue while
 * absolute entries still pass through and get HEAD-checked — never
 * worse than today, and visible in issues instead of silently dead.
 *
 * Baselines are computed from the TRANSFORMED (absolute) values — the
 * honest "what was actually pushed" semantic. Consequence: a product
 * pushed pre-P0 with relative image URLs may hit PRESERVE_CONFLICT on
 * its next sync (EcoMate changed relative → absolute, and the remote
 * differs from baseline if it stored nothing for the failed sideload)
 * — resolvable via the existing audited Force EcoMate Value override.
 * On staging this affects zero products (no product was ever pushed
 * with images).
 */
@Injectable()
export class PushMediaService {
  private readonly logger = new Logger(PushMediaService.name);
  private readonly fetcher: SecureFetcher;

  constructor(
    @Optional() private readonly tenantRegistry?: TenantRegistryService,
    @Optional() private readonly runs?: SyncRunService,
    @Optional()
    @Inject(SecureFetcher)
    fetcher?: SecureFetcher,
  ) {
    // SecureFetcher is not a registered provider (same pattern as
    // MediaService): @Optional resolves to undefined in production and
    // this default applies. Tests inject a mock.
    this.fetcher = fetcher ?? new SecureFetcher(defaultDns, defaultHttpTransport);
  }

  /**
   * Resolve the canonical public origin for a tenant's pushed image
   * URLs: `https://{slug}.{primaryDomain}`. Returns null when no slug
   * is resolvable anywhere (caller drops relative entries + records
   * MEDIA_ORIGIN_UNRESOLVED).
   */
  resolveMediaOrigin(
    tenantId?: string | null,
  ): { origin: string; host: string; source: 'registry' | 'context' } | null {
    const config =
      this.tenantRegistry?.getDomainConfig() ?? readTenantDomainConfig();

    // Primary: registry by tenant id (synced platform config preferred,
    // env fallback inside getDomainConfig()).
    if (tenantId && this.tenantRegistry) {
      const record = this.tenantRegistry.resolveById(tenantId);
      if (record?.slug) {
        const host = canonicalTenantHost(record.slug, config);
        return { origin: `https://${host}`, host, source: 'registry' };
      }
    }

    // Fallback: the ambient tenant slug. HTTP requests carry the real
    // slug; workers carry job.data.tenantSlug. 'queue' is the worker
    // placeholder — never a real slug. NOTE: we deliberately use the
    // SLUG here, never context.canonicalHost — a request that arrived
    // via a custom domain would carry the custom host, and D-1 says
    // pushed URLs use the stable faah.net host.
    const ctxSlug = getTenantContext()?.slug;
    if (ctxSlug && ctxSlug !== 'queue') {
      const host = canonicalTenantHost(ctxSlug, config);
      return { origin: `https://${host}`, host, source: 'context' };
    }

    return null;
  }

  /**
   * Shared absolutize + HEAD-verify core. One result per input entry, in
   * input order — callers decide how to aggregate (a plain list for
   * parent images, a per-SKU map for variant images). The drop reason is
   * per entry so a batch never has to guess which entry failed.
   */
  private async verifyEntries(
    raw: unknown[],
    origin: string | null,
  ): Promise<
    Array<{
      raw: unknown;
      candidate: string | null;
      ok: boolean;
      drop: 'invalid' | 'no-origin' | 'unreachable' | null;
    }>
  > {
    const classified = raw.map((entry) => {
      const c = classifyImageEntry(entry);
      if (c.kind === 'absolute') return { raw: entry, candidate: c.url, drop: null };
      if (c.kind === 'relative') {
        if (origin) return { raw: entry, candidate: `${origin}${c.path}`, drop: null };
        return { raw: entry, candidate: null, drop: 'no-origin' as const };
      }
      return { raw: entry, candidate: null, drop: 'invalid' as const };
    });
    // Reachability: HEAD every candidate in parallel. The indexed map
    // preserves order (primary image stays first) — a naive push in
    // completion order would scramble primary vs gallery.
    const checks = await Promise.all(
      classified.map(async (entry) => {
        if (!entry.candidate) return { ...entry, ok: false };
        try {
          await this.fetcher.head(entry.candidate, {
            totalTimeoutMs: PUSH_MEDIA_HEAD_TIMEOUT_MS,
            maxRedirects: PUSH_MEDIA_HEAD_MAX_REDIRECTS,
          });
          return { ...entry, ok: true };
        } catch (err) {
          this.logger.debug(
            `push media unreachable, dropping: ${entry.candidate} (${(err as Error)?.message ?? err})`,
          );
          return { ...entry, ok: false, drop: 'unreachable' as const };
        }
      }),
    );
    return checks;
  }

  /**
   * Prepare a product's images for a push: absolutize + HEAD-verify.
   * Returns the verified list (order preserved — index 0 is the
   * primary image) plus drop counts. Records issues via SyncRunService
   * when available; bookkeeping failures are logged, never fatal —
   * the push itself must not fail because its issue row did.
   */
  async preparePushImages(args: {
    storeId: string;
    tenantId?: string | null;
    productId: string;
    images: unknown[];
    runId?: string;
  }): Promise<PreparedPushImages> {
    const raw = Array.isArray(args.images) ? args.images : [];
    const empty: PreparedPushImages = {
      images: [],
      droppedInvalid: 0,
      droppedUnreachable: 0,
      droppedNoOrigin: 0,
      originResolved: false,
      origin: null,
    };
    // No images → no-op before any origin resolution or network call.
    if (raw.length === 0) return empty;

    const originResult = this.resolveMediaOrigin(args.tenantId ?? null);
    const origin = originResult?.origin ?? null;
    const results = await this.verifyEntries(raw, origin);

    const images: string[] = [];
    let droppedInvalid = 0;
    let droppedUnreachable = 0;
    let droppedNoOrigin = 0;
    const invalidSamples: string[] = [];
    for (const r of results) {
      if (r.ok && r.candidate) {
        images.push(r.candidate);
        continue;
      }
      if (r.drop === 'invalid') {
        droppedInvalid += 1;
        if (invalidSamples.length < 2) invalidSamples.push(String(r.raw).slice(0, 120));
      } else if (r.drop === 'no-origin') {
        droppedNoOrigin += 1;
      } else if (r.drop === 'unreachable') {
        droppedUnreachable += 1;
      }
    }

    await this.recordMediaOutcomes(args, {
      images,
      droppedInvalid,
      droppedUnreachable,
      droppedNoOrigin,
      originResolved: origin !== null,
      origin,
      invalidSamples,
    });

    return {
      images,
      droppedInvalid,
      droppedUnreachable,
      droppedNoOrigin,
      originResolved: origin !== null,
      origin,
    };
  }

  /**
   * Prepare per-variant images for a push: the SAME absolutize +
   * HEAD-verify core as parent images, keyed by variant SKU. Returns
   * the verified absolute URL per SKU — a dropped image simply has no
   * entry, so that variation pushes without an image (never a dead src,
   * never a failed push).
   *
   * Variant outcomes record under VARIANT_MEDIA_* codes (never the
   * parent MEDIA_* codes): the parent and variant batches share one
   * issue row per code per product, so sharing codes would let one
   * batch resolve the other's drop. One recording per batch, SKUs named
   * in the message.
   */
  async preparePushVariantImages(args: {
    storeId: string;
    tenantId?: string | null;
    productId: string;
    entries: Array<{ sku: string; image: unknown }>;
    runId?: string;
  }): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const entries = (Array.isArray(args.entries) ? args.entries : []).filter(
      (e) => e && typeof e.sku === 'string' && e.sku.length > 0,
    );
    // No variant images → no-op before any origin resolution or network call.
    if (entries.length === 0) return out;

    const originResult = this.resolveMediaOrigin(args.tenantId ?? null);
    const origin = originResult?.origin ?? null;
    const results = await this.verifyEntries(
      entries.map((e) => e.image),
      origin,
    );
    const dropped: Array<{ sku: string; drop: string }> = [];
    results.forEach((r, i) => {
      const sku = entries[i]!.sku;
      if (r.ok && r.candidate) {
        out.set(sku, r.candidate);
        return;
      }
      dropped.push({ sku, drop: r.drop ?? 'invalid' });
    });

    await this.recordVariantMediaOutcomes(args, dropped);
    return out;
  }

  private async recordVariantMediaOutcomes(
    args: { storeId: string; productId: string; runId?: string },
    dropped: Array<{ sku: string; drop: string }>,
  ): Promise<void> {
    if (!this.runs) return;
    const { storeId, productId, runId } = args;
    const objectKey = `product:${productId}`;
    const byDrop = (kind: string) => dropped.filter((d) => d.drop === kind);
    const skus = (list: Array<{ sku: string }>) =>
      list.map((d) => d.sku).slice(0, 3).join(', ');
    try {
      const invalid = byDrop('invalid');
      if (invalid.length > 0) {
        await this.runs.upsertIssue({
          storeId,
          code: 'VARIANT_MEDIA_URL_INVALID',
          objectType: 'PRODUCT',
          objectKey,
          productId,
          message: `${invalid.length} variant image URL(s) could not be parsed and were not pushed (SKUs: ${skus(invalid)}).`,
        });
        await this.recordSkippedItem(
          runId,
          storeId,
          productId,
          `VARIANT_MEDIA_URL_INVALID:${invalid.length} variant image URL(s) unparseable — dropped from the push (SKUs: ${skus(invalid)})`,
        );
      } else {
        await this.runs
          .resolveIssue(storeId, 'VARIANT_MEDIA_URL_INVALID', objectKey, 'All variant image URLs parse.')
          .catch(() => undefined);
      }

      const unreachable = byDrop('unreachable');
      if (unreachable.length > 0) {
        await this.runs.upsertIssue({
          storeId,
          code: 'VARIANT_MEDIA_UNREACHABLE',
          objectType: 'PRODUCT',
          objectKey,
          productId,
          message: `${unreachable.length} variant image(s) could not be reached at push time and were not pushed (SKUs: ${skus(unreachable)}); those variations were pushed without an image.`,
        });
        await this.recordSkippedItem(
          runId,
          storeId,
          productId,
          `VARIANT_MEDIA_UNREACHABLE:${unreachable.length} variant image(s) unreachable at push time — variations pushed without an image (SKUs: ${skus(unreachable)})`,
        );
      } else {
        await this.runs
          .resolveIssue(storeId, 'VARIANT_MEDIA_UNREACHABLE', objectKey, 'All pushed variant images reachable.')
          .catch(() => undefined);
      }

      const noOrigin = byDrop('no-origin');
      if (noOrigin.length > 0) {
        await this.runs.upsertIssue({
          storeId,
          code: 'VARIANT_MEDIA_ORIGIN_UNRESOLVED',
          objectType: 'PRODUCT',
          objectKey,
          productId,
          message: `${noOrigin.length} relative variant image URL(s) could not be absolutized — no canonical tenant host could be resolved — and were not pushed (SKUs: ${skus(noOrigin)}).`,
        });
        await this.recordSkippedItem(
          runId,
          storeId,
          productId,
          `VARIANT_MEDIA_ORIGIN_UNRESOLVED:${noOrigin.length} relative variant image(s) dropped — no canonical tenant host (SKUs: ${skus(noOrigin)})`,
        );
      } else {
        await this.runs
          .resolveIssue(storeId, 'VARIANT_MEDIA_ORIGIN_UNRESOLVED', objectKey, 'Canonical tenant host resolved.')
          .catch(() => undefined);
      }
    } catch (err) {
      // Bookkeeping must never fail the push.
      this.logger.warn(
        `push variant media issue recording failed for product ${productId}: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  private async recordMediaOutcomes(
    args: { storeId: string; productId: string; runId?: string },
    outcome: PreparedPushImages & { invalidSamples: string[] },
  ): Promise<void> {
    if (!this.runs) return;
    const { storeId, productId, runId } = args;
    const objectKey = `product:${productId}`;
    try {
      // MEDIA_URL_INVALID — unparseable entries dropped.
      if (outcome.droppedInvalid > 0) {
        const samples =
          outcome.invalidSamples.length > 0
            ? ` (${outcome.invalidSamples.join(', ')})`
            : '';
        await this.runs.upsertIssue({
          storeId,
          code: 'MEDIA_URL_INVALID',
          objectType: 'PRODUCT',
          objectKey,
          productId,
          message: `${outcome.droppedInvalid} image URL(s) could not be parsed and were not pushed${samples}.`,
        });
        await this.recordSkippedItem(
          runId,
          storeId,
          productId,
          `MEDIA_URL_INVALID:${outcome.droppedInvalid} image URL(s) unparseable — dropped from the push`,
        );
      } else {
        await this.runs
          .resolveIssue(
            storeId,
            'MEDIA_URL_INVALID',
            objectKey,
            'All image URLs parse.',
          )
          .catch(() => undefined);
      }

      // MEDIA_UNREACHABLE — HEAD failed; the product pushes imageless
      // (or with fewer images) with the reason on the record.
      if (outcome.droppedUnreachable > 0) {
        await this.runs.upsertIssue({
          storeId,
          code: 'MEDIA_UNREACHABLE',
          objectType: 'PRODUCT',
          objectKey,
          productId,
          message: `${outcome.droppedUnreachable} image(s) could not be reached at push time and were not pushed; the product was pushed ${outcome.images.length === 0 ? 'without images' : 'with the remaining images'}.`,
        });
        await this.recordSkippedItem(
          runId,
          storeId,
          productId,
          `MEDIA_UNREACHABLE:${outcome.droppedUnreachable} image(s) unreachable at push time — pushed ${outcome.images.length === 0 ? 'without images' : 'with the remaining images'}`,
        );
      } else {
        await this.runs
          .resolveIssue(
            storeId,
            'MEDIA_UNREACHABLE',
            objectKey,
            'All pushed images reachable.',
          )
          .catch(() => undefined);
      }

      // MEDIA_ORIGIN_UNRESOLVED — no canonical host, relative entries
      // dropped (absolute entries still pushed).
      if (outcome.droppedNoOrigin > 0) {
        await this.runs.upsertIssue({
          storeId,
          code: 'MEDIA_ORIGIN_UNRESOLVED',
          objectType: 'PRODUCT',
          objectKey,
          productId,
          message: `${outcome.droppedNoOrigin} relative image URL(s) could not be absolutized — no canonical tenant host could be resolved — and were not pushed.`,
        });
        await this.recordSkippedItem(
          runId,
          storeId,
          productId,
          `MEDIA_ORIGIN_UNRESOLVED:${outcome.droppedNoOrigin} relative image(s) dropped — no canonical tenant host`,
        );
      } else {
        await this.runs
          .resolveIssue(
            storeId,
            'MEDIA_ORIGIN_UNRESOLVED',
            objectKey,
            'Canonical tenant host resolved.',
          )
          .catch(() => undefined);
      }
    } catch (err) {
      // Bookkeeping must never fail the push.
      this.logger.warn(
        `push media issue recording failed for product ${productId}: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  private async recordSkippedItem(
    runId: string | undefined,
    storeId: string,
    productId: string,
    reason: string,
  ): Promise<void> {
    if (!runId || !this.runs) return;
    await this.runs.recordItem(runId, {
      storeId,
      productId,
      objectType: 'MEDIA',
      status: 'SKIPPED',
      reason,
      auditLevel: 'F',
    });
  }
}

export interface PreparedPushImages {
  /** Verified, absolute image URLs in original order (index 0 = primary). */
  images: string[];
  droppedInvalid: number;
  droppedUnreachable: number;
  droppedNoOrigin: number;
  originResolved: boolean;
  origin: string | null;
}

/** Per-URL HEAD budget — parallel across a product's images, so a
 *  gallery of dead URLs costs ~one timeout, not one per image. */
export const PUSH_MEDIA_HEAD_TIMEOUT_MS = 8_000;
export const PUSH_MEDIA_HEAD_MAX_REDIRECTS = 3;

type ClassifiedImageEntry =
  | { kind: 'absolute'; url: string }
  | { kind: 'relative'; path: string }
  | { kind: 'invalid' };

/**
 * Classify one raw `product.images` entry. Absolute http(s) URLs (and
 * protocol-relative `//host/path`, read as https) pass through;
 * root-relative paths (`/uploads/...`) are absolutized by the caller;
 * anything else — empty, non-string, bare `uploads/...` without a
 * leading slash, unknown scheme, whitespace — is unparseable and
 * dropped, never sent as a dead src.
 */
export function classifyImageEntry(entry: unknown): ClassifiedImageEntry {
  if (typeof entry !== 'string') return { kind: 'invalid' };
  const value = entry.trim();
  if (value.length === 0) return { kind: 'invalid' };
  if (/^https?:\/\/[^/]/i.test(value)) {
    // A host must follow :// immediately — Node leniently parses
    // `https:///no-host.jpg` as host `no-host.jpg`, which is not a URL
    // shape we ever want to send.
    try {
      const parsed = new URL(value);
      if (!parsed.hostname) return { kind: 'invalid' };
      return { kind: 'absolute', url: value };
    } catch {
      return { kind: 'invalid' };
    }
  }
  if (value.startsWith('//')) {
    try {
      const parsed = new URL(`https:${value}`);
      if (!parsed.hostname) return { kind: 'invalid' };
      return { kind: 'absolute', url: `https:${value}` };
    } catch {
      return { kind: 'invalid' };
    }
  }
  if (value.startsWith('/')) {
    if (/\s/.test(value)) return { kind: 'invalid' };
    return { kind: 'relative', path: value };
  }
  return { kind: 'invalid' };
}
