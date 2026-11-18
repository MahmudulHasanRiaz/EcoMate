import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * Landing cache purge (Batch 1, item 3): the console's "Purge landing
 * cache" button calls this service, which POSTs to the landing app's
 * secret-guarded POST /api/revalidate route. The shared secret lives
 * server-side only — it never reaches the browser.
 *
 * The landing is reached on its INTERNAL URL (same Docker network in
 * production, localhost in dev), not the public www host: the purge
 * must work even when the public edge is down.
 */
export function landingInternalBase(): string {
  return (
    process.env.LANDING_INTERNAL_URL || 'http://localhost:3002'
  ).replace(/\/+$/, '');
}

@Injectable()
export class LandingCacheService {
  private readonly logger = new Logger(LandingCacheService.name);

  async purge(): Promise<{ revalidated: string[] }> {
    const secret = (process.env.INTERNAL_SERVICE_SECRET ?? '').trim();
    if (!secret) {
      throw new ServiceUnavailableException(
        'Landing cache purge is not configured (INTERNAL_SERVICE_SECRET is unset)',
      );
    }
    let response: Response;
    try {
      response = await fetch(`${landingInternalBase()}/api/revalidate`, {
        method: 'POST',
        headers: {
          'x-internal-secret': secret,
          'Content-Type': 'application/json',
        },
        // No tag = purge everything (the landing revalidates all tags).
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.logger.warn(
        `Landing cache purge failed — landing unreachable: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new ServiceUnavailableException(
        'Landing is unreachable — cache not purged',
      );
    }
    if (!response.ok) {
      this.logger.warn(
        `Landing cache purge rejected (HTTP ${response.status})`,
      );
      throw new ServiceUnavailableException(
        `Landing cache purge failed (HTTP ${response.status})`,
      );
    }
    // Pass the landing's tag list through so the console can show what
    // was purged; a missing/malformed body still means success.
    const data: unknown =
      typeof response.json === 'function'
        ? await response.json().catch(() => null)
        : null;
    const tags =
      data && typeof data === 'object' && Array.isArray((data as { revalidated?: unknown }).revalidated)
        ? ((data as { revalidated: unknown[] }).revalidated.filter(
            (tag): tag is string => typeof tag === 'string',
          ))
        : [];
    return { revalidated: tags };
  }
}
