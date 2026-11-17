import { Processor } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { MediaJob, MediaQueueService } from './media-queue.service';
import { generateDerivatives } from './derivatives';
import { runPerTenant, TenantWorkerHost } from '../../tenancy/tenant-job';
import { TenantRegistryService } from '../../tenancy/tenant-registry.service';

const NON_NATIVE_FORMATS = new Set([
  'image/heic',
  'image/heif',
  'image/tiff',
  'image/bmp',
  'image/avif',
]);

@Processor('media')
export class MediaQueueProcessor extends TenantWorkerHost<MediaJob> {
  private readonly logger = new Logger(MediaQueueProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mediaQueue: MediaQueueService,
    // Plain parameter (not a property): the base class owns the
    // `tenantRegistry` property; `this.tenantRegistry` below resolves to it.
    @Optional()
    tenantRegistry?: TenantRegistryService,
  ) {
    super(tenantRegistry);
  }

  private async loadSharp() {
    const mod = await import('sharp');
    return mod.default;
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === 'recover') {
      await runPerTenant(this.tenantRegistry, async () => {
        await this.mediaQueue.recoverStuck();
      });
      return;
    }

    // Return the base result: the skip marker ({ skipped: ... }) is the
    // job's returnvalue, and BullMQ only records what process() returns.
    return super.process(job);
  }

  protected async handle(job: Job<MediaJob>): Promise<void> {
    const { mediaId } = job.data;

    const media = await this.prisma.media.findFirst({
      where: { id: mediaId },
    });

    if (!media) {
      this.logger.warn(`Media ${mediaId} not found, skipping`);
      return;
    }

    if (!media.mimeType.startsWith('image/')) {
      await this.prisma.media.update({
        where: { id: mediaId },
        data: { processingStatus: 'READY' },
      });
      return;
    }

    await this.prisma.media.update({
      where: { id: mediaId },
      data: { processingStatus: 'PROCESSING', updatedAt: new Date() },
    });

    try {
      const sharp = await this.loadSharp();
      const original = await this.storage.readMediaOriginal(
        media.filename,
        media.url,
      );
      const metadata = await sharp(original).metadata();
      const needsJpegFallback = NON_NATIVE_FORMATS.has(media.mimeType);

      // WebP (unchanged) + additive AVIF siblings + optional JPEG
      // fallback — see derivatives.ts for the manifest contract and the
      // measured AVIF settings. Re-running this job (backfill-avif)
      // regenerates the same storage keys, so it is idempotent.
      const { manifest, blurUrl } = await generateDerivatives({
        sharp: sharp as never,
        original,
        mediaId,
        needsJpegFallback,
        store: (key, buf, contentType) =>
          this.storage.store(key, buf, contentType),
        onAvifError: (size, err) =>
          this.logger.warn(
            `AVIF derivative failed for media ${mediaId} (${size}): ${err.message} — WebP remains available`,
          ),
      });

      await this.prisma.media.update({
        where: { id: mediaId },
        data: {
          processingStatus: 'READY',
          derivativeManifest: manifest,
          blurUrl,
          updatedAt: new Date(),
        },
      });
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Failed to process media ${mediaId}: ${msg}`);

      // Best-effort status update — if this fails too, log but still rethrow original
      try {
        await this.prisma.media.update({
          where: { id: mediaId },
          data: {
            processingStatus: 'FAILED',
            processingError: msg,
            updatedAt: new Date(),
          },
        });
      } catch (updateErr) {
        this.logger.error(
          `Failed to persist FAILED status for media ${mediaId}: ${(updateErr as Error).message}`,
        );
      }

      // Rethrow original so BullMQ retries with configured attempts/backoff
      throw err;
    }
  }
}
