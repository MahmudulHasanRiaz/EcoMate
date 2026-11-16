import {
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SubmitProofDto } from './dto/submit-proof.dto';

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Tenant billing, proxied to the platform API. The tenant backend never
 * owns billing data — it forwards the current tenant's id (from the tenant
 * context, never from the request body) to the platform's internal
 * endpoints with the service token.
 */
@Injectable()
export class TenantBillingService {
  private platformBase(): string {
    const base = process.env.PLATFORM_API_URL;
    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (!base || !secret) {
      throw new ServiceUnavailableException(
        'Billing is not configured for this workspace (PLATFORM_API_URL / INTERNAL_SERVICE_SECRET)',
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
        `Platform billing request failed (${response.status})`;
      throw new HttpException(message, response.status);
    }
    return response.json().catch(() => null);
  }

  methods() {
    return this.platformFetch('/internal/payment-methods');
  }

  invoices(tenantId: string) {
    return this.platformFetch(
      `/internal/tenants/${encodeURIComponent(tenantId)}/invoices`,
    );
  }

  async invoice(tenantId: string, invoiceId: string) {
    const invoices = (await this.invoices(tenantId)) as any[];
    const found = invoices.find((invoice) => invoice.id === invoiceId);
    if (!found) throw new NotFoundException('Invoice not found');
    return found;
  }

  submitProof(tenantId: string, invoiceId: string, dto: SubmitProofDto) {
    return this.platformFetch(
      `/internal/tenants/${encodeURIComponent(tenantId)}/proofs`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...dto, invoiceId }),
      },
    );
  }

  /** Streams the platform-rendered invoice PDF through to the tenant. */
  async invoicePdf(tenantId: string, invoiceId: string): Promise<{
    stream: NodeJS.ReadableStream;
    filename: string;
  }> {
    const base = this.platformBase();
    const secret = process.env.INTERNAL_SERVICE_SECRET!;
    const response = await fetch(
      `${base}/internal/tenants/${encodeURIComponent(tenantId)}/invoices/${encodeURIComponent(invoiceId)}/pdf`,
      {
        headers: { 'x-platform-service-token': secret },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new HttpException(
        body?.message ?? `Invoice PDF failed (${response.status})`,
        response.status,
      );
    }
    if (!response.body) {
      throw new ServiceUnavailableException('Invoice PDF had no body');
    }
    const { Readable } = await import('stream');
    const filename =
      response.headers
        .get('content-disposition')
        ?.match(/filename="([^"]+)"/)?.[1] ?? `invoice-${invoiceId}.pdf`;
    return { stream: Readable.fromWeb(response.body as any), filename };
  }
}
