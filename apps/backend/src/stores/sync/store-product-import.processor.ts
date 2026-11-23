/**
 * Product-import processors — WooCommerce product import (§10.2–10.3, R5).
 *
 * Two queues:
 * - `store-product-import` (page jobs): a thin loop over
 *   `StoreProductImportService.importOne` — one child run per 100-product
 *   page, batch run + completion sweep, per-store serialization, G-4
 *   kill-switch refusal, cancel-before-start check.
 * - `store-product-import-images` (image jobs): one job per created
 *   product; downloads up to 10 images in the background with retry +
 *   backoff. The import run NEVER waits for images.
 *
 * Batch lifecycle: the batch run finishes only via the completion sweep
 * (inline, under the store lock, after each child run finishes) once every
 * page's child run is in a terminal state. A CANCELLED batch is never
 * re-finished. A refused page job (kill switch off) still records its
 * child run as FAILED:IMPORT_DISABLED so the batch cannot hang RUNNING.
 */
import { Processor } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantRegistryService } from '../../tenancy/tenant-registry.service';
import { TenantWorkerHost } from '../../tenancy/tenant-job';
import { MediaService } from '../../media/media.service';
import { productImportEnabled } from '../store-flags';
import type { ImportDecisionDto } from '../dto/import.dto';
import { IMPORT_IMAGE_CAP } from './normalize-product';
import {
  newImportPageCache,
  StoreProductImportService,
  type ImportBatchMetadata,
  type ImportRunContext,
} from './store-product-import.service';
import { SyncQueuesService } from './sync-queues.service';
import { SyncRunService } from './sync-run.service';

async function boundedMap<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(null).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

const TERMINAL_CHILD_STATUSES = new Set(['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED']);

interface ImportPageJobData {
  batchRunId: string;
  storeId: string;
  pageIndex: number;
  decisions: ImportDecisionDto[];
}

interface ImportImagesJobData {
  batchRunId: string;
  storeId: string;
  productId: string;
  externalId: string;
  images: Array<{ src: string; alt: string | null }>;
}

@Processor('store-product-import', { concurrency: 2, limiter: { max: 10, duration: 1000 } })
export class StoreProductImportProcessor extends TenantWorkerHost {
  private readonly logger = new Logger(StoreProductImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly imports: StoreProductImportService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    @Optional() tenantRegistry?: TenantRegistryService,
  ) {
    super(tenantRegistry);
  }

  protected async handle(job: Job): Promise<unknown> {
    const data = job.data as ImportPageJobData;
    if (job.name !== 'import-page') return { ignored: job.name };

    // G-4: refuse when the kill switch is off — but still close the page
    // out (FAILED:IMPORT_DISABLED items + sweep) so the batch cannot hang
    // RUNNING with a missing child run.
    if (!productImportEnabled()) {
      this.logger.log(`product import refused (flag off): job ${job.name} ${job.id ?? ''}`);
      return this.queues.serializeStore(data.storeId, () =>
        this.refusePage(data),
      );
    }
    return this.queues.serializeStore(data.storeId, () => this.processPage(data));
  }

  private async refusePage(data: ImportPageJobData): Promise<{ refused: boolean }> {
    const batch = await this.imports.getBatchRun(data.batchRunId);
    if (!batch || (batch as any).status === 'CANCELLED') return { refused: true };
    const child = await this.runs.begin({
      scope: 'PRODUCT_IMPORT',
      triggerType: ((batch as any).triggerType ?? 'MANUAL') as any,
      storeId: data.storeId,
      parentRunId: data.batchRunId,
    });
    for (const d of data.decisions) {
      await this.runs.recordItem(child.id, {
        storeId: data.storeId,
        objectType: 'PRODUCT',
        externalObjectId: d.remoteId,
        status: 'FAILED',
        reason: 'FAILED:IMPORT_DISABLED',
      });
    }
    await this.finishPage(
      child.id,
      { created: 0, updated: 0, skipped: 0, failed: data.decisions.length },
      data.batchRunId,
    );
    return { refused: true };
  }

  private async processPage(data: ImportPageJobData): Promise<{
    childRunId: string;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  }> {
    const batch = await this.imports.getBatchRun(data.batchRunId);
    if (!batch) return { childRunId: '', created: 0, updated: 0, skipped: 0, failed: 0 };
    // Cancel-before-start: a cancelled batch's queued pages do no work.
    if ((batch as any).status === 'CANCELLED') {
      return { childRunId: '', created: 0, updated: 0, skipped: 0, failed: 0 };
    }
    if ((batch as any).status !== 'RUNNING') {
      // Duplicate delivery after the batch finished — nothing to do.
      return { childRunId: '', created: 0, updated: 0, skipped: 0, failed: 0 };
    }
    const meta = ((batch as any).metadata as ImportBatchMetadata | null)?.import;
    if (!meta) {
      this.logger.warn(`import batch ${data.batchRunId} has no import metadata`);
      return { childRunId: '', created: 0, updated: 0, skipped: 0, failed: 0 };
    }

    const child = await this.runs.begin({
      scope: 'PRODUCT_IMPORT',
      triggerType: ((batch as any).triggerType ?? 'MANUAL') as any,
      storeId: data.storeId,
      initiatedById: (batch as any).initiatedById ?? undefined,
      parentRunId: data.batchRunId,
    });
    const counts = { created: 0, updated: 0, skipped: 0, failed: 0 };
    let imageJobsEnqueued = 0;
    const summaryDelta = { variantsImported: 0, categoriesCreated: 0, categoriesReused: 0 };

    // Store no longer importable (disconnected / kind changed): fail the
    // whole page explicitly so the operator can reconnect and retry.
    // This catch covers ONLY the context build — the item loop below has
    // per-item isolation and must never re-fail already-processed items.
    let ctx: ImportRunContext;
    try {
      const { store, provider, secrets } = await this.imports.importContext(data.storeId);
      ctx = {
        batchRunId: data.batchRunId,
        childRunId: child.id,
        storeId: data.storeId,
        store,
        provider,
        secrets,
        options: {
          publishMode: meta.publishMode,
          categoryMode: meta.categoryMode,
          categoryId: meta.categoryId,
          stockTick: meta.stockTick,
          skipImages: meta.skipImages,
          idempotencyKey: meta.idempotencyKey,
        },
        initiatedById: (batch as any).initiatedById ?? undefined,
        cache: newImportPageCache(),
      };
    } catch (err) {
      this.logger.warn(
        `import page ${data.pageIndex} aborted (store unavailable): ${(err as Error)?.message ?? err}`,
      );
      for (const d of data.decisions) {
        await this.runs.recordItem(child.id, {
          storeId: data.storeId,
          objectType: 'PRODUCT',
          externalObjectId: d.remoteId,
          status: 'FAILED',
          reason: 'FAILED:STORE_UNAVAILABLE',
        });
        counts.failed += 1;
      }
      await this.finishPage(child.id, counts, data.batchRunId);
      return { childRunId: child.id, ...counts };
    }

    {
      const { provider, secrets } = ctx;

      // One list call for the whole page (include[]), plus one variations
      // call per variable product (bounded concurrency). Products omitted
      // from the list (trashed/deleted/stale) get the fetchProduct
      // fallback inside importOne.
      const remoteById = new Map<string, Record<string, unknown>>();
      try {
        const listed = await provider.listProducts(secrets, {
          page: 1,
          pageSize: 100,
          include: data.decisions.map((d) => d.remoteId),
          status: ['publish', 'draft', 'private', 'pending'],
        });
        for (const p of listed.products) {
          remoteById.set(String((p as Record<string, unknown>).id ?? ''), p as Record<string, unknown>);
        }
      } catch (err) {
        // Page-level provider failure: every decision fails explicitly so
        // the operator can retry FAILED items (never a silent hang).
        this.logger.warn(
          `import page ${data.pageIndex} list failed: ${(err as Error)?.message ?? err}`,
        );
        for (const d of data.decisions) {
          await this.runs.recordItem(child.id, {
            storeId: data.storeId,
            objectType: 'PRODUCT',
            externalObjectId: d.remoteId,
            status: 'FAILED',
            reason: 'FAILED:PROVIDER_ERROR',
          });
          counts.failed += 1;
        }
        await this.finishPage(child.id, counts, data.batchRunId);
        return { childRunId: child.id, ...counts };
      }

      const variableIds = [...remoteById.entries()]
        .filter(([, b]) => String(b.type ?? '') === 'variable')
        .map(([id]) => id);
      const variationLists = await boundedMap(variableIds, 5, async (id) => {
        try {
          return { id, variations: await this.imports.fetchAllVariations(ctx, id) };
        } catch (err) {
          // Variations are per-product: a failed fetch fails only that
          // product (importOne still runs — with zero variations the
          // product imports as simple; record the gap as an issue).
          // The issue write is best-effort: it must never fail the page.
          this.logger.warn(`variations fetch failed for ${id}: ${(err as Error)?.message ?? err}`);
          try {
            await this.runs.upsertIssue({
              storeId: data.storeId,
              code: 'VARIATIONS_FETCH_FAILED',
              objectType: 'PRODUCT',
              objectKey: id,
              message: 'Variations could not be fetched; the product imported without its variations.',
            });
          } catch (issueErr) {
            this.logger.warn(`VARIATIONS_FETCH_FAILED issue write failed: ${(issueErr as Error)?.message ?? issueErr}`);
          }
          return { id, variations: [] as never[] };
        }
      });
      const variationsById = new Map(variationLists.map((v) => [v.id, v.variations]));

      // Sequential per-item loop: per-item isolation (§13.3) — one
      // poisoned item never aborts the page, and the page cache stays
      // coherent without cross-item slug races.
      for (const decision of data.decisions) {
        const remote = remoteById.get(decision.remoteId) ?? null;
        const variations = variationsById.get(decision.remoteId) ?? [];
        try {
          const outcome = await this.imports.importOne(ctx, { remote, variations, decision });
          if (outcome.imageJobEnqueued) imageJobsEnqueued += 1;
          summaryDelta.variantsImported += outcome.variantsImported ?? 0;
          summaryDelta.categoriesCreated += outcome.categoriesCreated ?? 0;
          summaryDelta.categoriesReused += outcome.categoriesReused ?? 0;
          switch (outcome.status) {
            case 'created':
              counts.created += 1;
              break;
            case 'linked':
              counts.updated += 1;
              break;
            case 'skipped':
            case 'remote_deleted':
              counts.skipped += 1;
              break;
            case 'failed':
              counts.failed += 1;
              break;
          }
        } catch (err) {
          counts.failed += 1;
          await this.runs.recordItem(child.id, {
            storeId: data.storeId,
            objectType: 'PRODUCT',
            externalObjectId: decision.remoteId,
            status: 'FAILED',
            reason: 'FAILED:UNEXPECTED',
            errorCategory: err instanceof Error ? err.name : 'Error',
          });
          this.logger.warn(
            `import ${decision.remoteId} unexpected failure: ${(err as Error)?.message ?? err}`,
          );
        }
      }
    }

    if (imageJobsEnqueued > 0) {
      try {
        await this.imports.bumpImageJobsTotal(data.batchRunId, imageJobsEnqueued);
      } catch (err) {
        // Best-effort counter: a failed bump must not fail the page (the
        // image-status total just under-reports until the next page).
        this.logger.warn(`bumpImageJobsTotal failed: ${(err as Error)?.message ?? err}`);
      }
    }
    if (
      summaryDelta.variantsImported > 0 ||
      summaryDelta.categoriesCreated > 0 ||
      summaryDelta.categoriesReused > 0
    ) {
      try {
        await this.imports.bumpImportSummary(data.batchRunId, summaryDelta);
      } catch (err) {
        // Best-effort like the image bump: the result screen's second-row
        // counts just under-report; the run itself is unaffected.
        this.logger.warn(`bumpImportSummary failed: ${(err as Error)?.message ?? err}`);
      }
    }
    await this.finishPage(child.id, counts, data.batchRunId);
    return { childRunId: child.id, ...counts };
  }

  /**
   * Finish a child run + run the completion sweep. A failed finish must
   * not throw out of the page job (attempts:1 — the job would die with the
   * child run stuck RUNNING and the batch hung); log loudly instead so
   * ops can see it and finish the run manually.
   */
  private async finishPage(
    childRunId: string,
    counts: { created: number; updated: number; skipped: number; failed: number },
    batchRunId: string,
  ): Promise<void> {
    try {
      await this.runs.finish(childRunId, counts);
    } catch (err) {
      this.logger.error(`finishing import child run ${childRunId} failed: ${(err as Error)?.message ?? err}`);
      return;
    }
    try {
      await this.completionSweep(batchRunId);
    } catch (err) {
      this.logger.error(`import completion sweep failed for ${batchRunId}: ${(err as Error)?.message ?? err}`);
    }
  }

  /**
   * Batch completion sweep (§10.3): once every page's child run is
   * terminal, finish the batch with the aggregated counts. Runs inline
   * under the store lock after each child run finishes. A CANCELLED batch
   * is never re-finished.
   */
  private async completionSweep(batchRunId: string): Promise<void> {
    const batch = await this.imports.getBatchRun(batchRunId);
    if (!batch || (batch as any).status !== 'RUNNING') return;
    const meta = ((batch as any).metadata as ImportBatchMetadata | null)?.import;
    const pageCount = meta?.pageCount ?? 0;
    const children = await this.runs.childRuns(batchRunId);
    if (children.length < pageCount) return;
    if (!children.every((c) => TERMINAL_CHILD_STATUSES.has((c as any).status))) return;
    const totals = { created: 0, updated: 0, skipped: 0, failed: 0 };
    for (const c of children) {
      totals.created += (c as any).createdCount ?? 0;
      totals.updated += (c as any).updatedCount ?? 0;
      totals.skipped += (c as any).skippedCount ?? 0;
      totals.failed += (c as any).failedCount ?? 0;
    }
    await this.runs.finish(batchRunId, totals);
    this.logger.log(
      `import batch ${batchRunId} finished: ${totals.created} created, ${totals.updated} linked, ${totals.skipped} skipped, ${totals.failed} failed`,
    );
  }
}

@Processor('store-product-import-images', { concurrency: 5, limiter: { max: 10, duration: 1000 } })
export class StoreProductImportImagesProcessor extends TenantWorkerHost {
  private readonly logger = new Logger(StoreProductImportImagesProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly runs: SyncRunService,
    private readonly queues: SyncQueuesService,
    @Optional() tenantRegistry?: TenantRegistryService,
  ) {
    super(tenantRegistry);
  }

  protected async handle(job: Job): Promise<unknown> {
    const data = job.data as ImportImagesJobData;
    if (job.name !== 'import-images') return { ignored: job.name };
    const images = (data.images ?? []).slice(0, IMPORT_IMAGE_CAP);
    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

    // G-4: image jobs refuse when import is disabled — but record the
    // outcome so the image-status endpoint never shows them pending.
    if (!productImportEnabled()) {
      this.logger.log(`import images refused (flag off): job ${job.id ?? ''}`);
      await this.recordImageItem(data, `IMAGES_FAILED:${images.length}`, 'FAILED');
      return { refused: true };
    }

    return this.queues.serializeStore(data.storeId, async () => {
      // Per-image isolation: one bad URL never fails the product's other
      // images. ingestFromUrl dedupes by sourceUrl, so a BullMQ retry
      // reuses already-downloaded images instead of re-fetching them.
      const succeeded: string[] = [];
      let failedCount = 0;
      for (const img of images) {
        try {
          const ingested = await this.media.ingestFromUrl(img.src, { alt: img.alt ?? undefined });
          succeeded.push(ingested.url);
        } catch (err) {
          failedCount += 1;
          this.logger.warn(
            `image download failed for product ${data.productId} (${img.src}): ${(err as Error)?.message ?? err}`,
          );
        }
      }

      // Save incrementally: partial downloads survive (R5).
      if (succeeded.length > 0) {
        try {
          const urls = await this.media.syncEntityImages('product', data.productId, succeeded);
          await this.prisma.product.update({
            where: { id: data.productId },
            data: { images: urls },
          });
        } catch (err) {
          this.logger.warn(
            `attaching images failed for product ${data.productId}: ${(err as Error)?.message ?? err}`,
          );
          failedCount += succeeded.length;
          succeeded.length = 0;
        }
      }

      const downloaded = succeeded.length;
      if (failedCount === 0) {
        await this.recordImageItem(data, `IMAGES_OK:${downloaded}`, 'SUCCESS');
        return { downloaded };
      }

      if (!isFinalAttempt) {
        // BullMQ retries the whole job (exponential backoff); the
        // already-downloaded images dedupe on the retry.
        throw new Error(
          `image download: ${failedCount}/${images.length} failed for product ${data.productId} (attempt ${job.attemptsMade + 1}/${maxAttempts})`,
        );
      }

      // Final attempt: record the persistent failure (issue + run item)
      // inside handle() where the tenant context is available, then
      // complete the job — the failure is recorded, not retried forever.
      await this.runs.upsertIssue({
        storeId: data.storeId,
        code: 'IMAGE_DOWNLOAD_FAILED',
        objectType: 'MEDIA',
        objectKey: data.externalId,
        productId: data.productId,
        message: `${failedCount} of ${images.length} image(s) could not be downloaded after ${maxAttempts} attempts; the product kept ${downloaded} image(s).`,
      });
      if (downloaded > 0) {
        await this.recordImageItem(data, `IMAGES_PARTIAL:${downloaded}/${failedCount}`, 'SUCCESS');
      } else {
        await this.recordImageItem(data, `IMAGES_FAILED:${failedCount}`, 'FAILED');
      }
      return { downloaded, failed: failedCount };
    });
  }

  /** Image items live on the BATCH run (the child run may be finished). */
  private async recordImageItem(
    data: ImportImagesJobData,
    reason: string,
    status: 'SUCCESS' | 'FAILED',
  ): Promise<void> {
    await this.runs.recordItem(data.batchRunId, {
      storeId: data.storeId,
      productId: data.productId,
      objectType: 'MEDIA',
      externalObjectId: data.externalId,
      status,
      reason,
    });
  }
}
