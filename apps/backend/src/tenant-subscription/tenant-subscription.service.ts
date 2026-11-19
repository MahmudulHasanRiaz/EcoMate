import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Tenant self-service subscription data, proxied to the platform API.
 * The tenant backend never owns plan or request data — it forwards the
 * current tenant's id (from the tenant context, never from the request
 * body) to the platform's internal endpoints with the service token,
 * and proxies the public plan catalogue for the Subscription hub.
 *
 * Platform errors pass through with their status + message intact:
 * 400 (private plan / already on this plan), 409 (a PENDING request
 * already exists) — the tenant admin surfaces each one.
 */
@Injectable()
export class TenantSubscriptionService {
  private platformBase(): string {
    const base = process.env.PLATFORM_API_URL;
    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!base || !secret) {
      throw new ServiceUnavailableException(
        'Subscription plans are not configured for this workspace (PLATFORM_API_URL / INTERNAL_SERVICE_SECRET)',
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
        `Platform subscription request failed (${response.status})`;
      throw new HttpException(message, response.status);
    }
    return response.json().catch(() => null);
  }

  private tenantPath(tenantId: string, suffix = ''): string {
    return `/internal/tenants/${encodeURIComponent(tenantId)}/plan-change-requests${suffix}`;
  }

  /** Public plan catalogue (same shape as the landing's /public/plans). */
  listPublicPlans() {
    return this.platformFetch('/public/plans');
  }

  listRequests(tenantId: string) {
    return this.platformFetch(this.tenantPath(tenantId));
  }

  createRequest(
    tenantId: string,
    dto: { targetPlanId: string; note?: string },
    requestedBy?: string | null,
  ) {
    return this.platformFetch(this.tenantPath(tenantId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...dto, requestedBy: requestedBy ?? null }),
    });
  }

  getRequest(tenantId: string, id: string) {
    return this.platformFetch(
      this.tenantPath(tenantId, `/${encodeURIComponent(id)}`),
    );
  }
}
