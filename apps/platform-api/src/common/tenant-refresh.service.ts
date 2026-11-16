import { Injectable, Logger } from '@nestjs/common';

const REFRESH_TIMEOUT_MS = 5_000;

function apiBase(): string {
  return (
    process.env.TENANT_BACKEND_URL || 'http://backend:4000/api'
  ).replace(/\/+$/, '');
}

/**
 * Best-effort push of a registry refresh to the tenant backend. The backend
 * polls the platform registry on its own (60s default), so a failed push is
 * never fatal — the tenant picks the change up on the next poll. Callers
 * log the failure and move on.
 */
@Injectable()
export class TenantRefreshService {
  private readonly logger = new Logger(TenantRefreshService.name);

  async pushRefresh(slug: string): Promise<{ ok: boolean; error?: string }> {
    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!secret) {
      return {
        ok: false,
        error:
          'INTERNAL_SERVICE_SECRET is not configured; the tenant will pick up the change on its next registry poll',
      };
    }

    try {
      const response = await fetch(`${apiBase()}/entitlements/refresh`, {
        method: 'POST',
        headers: { 'x-platform-service-token': secret },
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
      if (!response.ok) {
        return { ok: false, error: `Tenant refresh HTTP ${response.status}` };
      }
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Tenant refresh push failed for ${slug}: ${message}`);
      return { ok: false, error: message };
    }
  }
}
