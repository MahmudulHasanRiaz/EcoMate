import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Tenant self-service custom domains, proxied to the platform API. The
 * tenant backend never owns domain data — it forwards the current
 * tenant's id (from the tenant context, never from the request body)
 * to the platform's internal endpoints with the service token.
 *
 * Platform errors pass through with their status + message intact:
 * 403 (plan lacks the `custom_domain` feature), 409 (domain already
 * assigned), 400 (invalid hostname) — the tenant admin surfaces each
 * one, and a 403 flips the page to its locked state.
 */
@Injectable()
export class TenantDomainsService {
  private platformBase(): string {
    const base = process.env.PLATFORM_API_URL;
    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!base || !secret) {
      throw new ServiceUnavailableException(
        'Custom domains are not configured for this workspace (PLATFORM_API_URL / INTERNAL_SERVICE_SECRET)',
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
        `Platform domains request failed (${response.status})`;
      throw new HttpException(message, response.status);
    }
    return response.json().catch(() => null);
  }

  private tenantPath(tenantId: string, suffix = ''): string {
    return `/internal/tenants/${encodeURIComponent(tenantId)}/domains${suffix}`;
  }

  list(tenantId: string) {
    return this.platformFetch(this.tenantPath(tenantId));
  }

  add(tenantId: string, host: string) {
    return this.platformFetch(this.tenantPath(tenantId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host }),
    });
  }

  recheck(tenantId: string, domainId: string) {
    return this.platformFetch(
      this.tenantPath(tenantId, `/${encodeURIComponent(domainId)}/recheck`),
      { method: 'POST' },
    );
  }

  remove(tenantId: string, domainId: string) {
    return this.platformFetch(
      this.tenantPath(tenantId, `/${encodeURIComponent(domainId)}`),
      { method: 'DELETE' },
    );
  }
}
