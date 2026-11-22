/**
 * Store bridge contact-check — central-commerce P6 (§8.5.1, BR-14).
 *
 * Exposure, NEVER enforcement: a signed, read-only endpoint the companion
 * plugin / custom bridge calls during ITS checkout so the EXTERNAL channel
 * may decide whether to prevent an order before creating it. Enforcement is
 * entirely the external channel's responsibility.
 *
 *   GET /store-bridge/v1/contact-check?storeId=&phone=&ip=&timestamp=&signature=
 *
 * `signature` = hex HMAC-SHA256 over `${phone}.${ip}.${timestamp}` with the
 * store's webhook secret; `timestamp` is epoch seconds inside the 5-minute
 * replay window. The endpoint performs NO writes (no order, no audit row, no
 * counters — read-only by construction) and is NEVER consulted by EcoMate's
 * own ingest path (asserted statically by the blocked-ingest suite).
 */
import { Controller, Get, Optional, Query, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Public } from '../../common/decorators/public.decorator';
import { SkipTenant } from '../../tenancy/skip-tenant.decorator';
import { SkipSubscription } from '../../tenancy/skip-subscription.decorator';
import { RateLimitPolicy } from '../../common/rate-limit/rate-limit-policy.decorator';
import { runWithTenant } from '../../tenancy/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { ExternalStoreResolver } from '../../external-stores/external-store-resolver.service';
import { StoresService } from '../stores.service';
import { BlockedEntriesService } from '../../blocked-entries/blocked-entries.service';
import { CustomersService } from '../../customers/customers.service';
import { normalizePhone } from '../../common/utils/phone-utils';
import { isTimestampFresh } from '../providers/webhook-crypto';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

@Controller('store-bridge/v1')
@Public()
@SkipTenant()
// See StoreWebhooksController: without this the global subscription guard
// 403s the no-tenant-context contact-check in production.
@SkipSubscription()
@RateLimitPolicy('store_webhook')
export class StoreBridgeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
    private readonly blockedEntries: BlockedEntriesService,
    private readonly customers: CustomersService,
    // SaaS §3.3 — trailing @Optional so specs constructing the
    // controller manually keep working; production always wires it.
    @Optional() private readonly resolver?: ExternalStoreResolver,
  ) {}

  @Get('contact-check')
  async contactCheck(
    @Query('storeId') storeId?: string,
    @Query('phone') phone?: string,
    @Query('ip') ip?: string,
    @Query('timestamp') timestamp?: string,
    @Query('signature') signature?: string,
  ): Promise<{ blocked: boolean; reasons: string[] }> {
    if (!storeId || !signature || !timestamp) {
      throw new UnauthorizedException('Unauthorized');
    }
    if (!isTimestampFresh(timestamp)) {
      throw new UnauthorizedException('Unauthorized');
    }
    // SaaS §3.3: resolve storeId → tenant FIRST, before any Prisma query;
    // the HMAC verification + blocked-entry reads run inside that
    // tenant's context. Unknown/unbound → the same generic 401.
    if (this.resolver) {
      const resolved = await this.resolver.resolveStore(storeId);
      if (!resolved) throw new UnauthorizedException('Unauthorized');
      return runWithTenant(
        { tenantId: resolved.tenantId, slug: 'bridge', status: 'ACTIVE' },
        () => this.contactCheckInTenant(storeId, phone, ip, timestamp, signature),
      );
    }
    return this.contactCheckInTenant(storeId, phone, ip, timestamp, signature);
  }

  private async contactCheckInTenant(
    storeId: string,
    phone?: string,
    ip?: string,
    timestamp?: string,
    signature?: string,
  ): Promise<{ blocked: boolean; reasons: string[] }> {
    // The public entry point already guards these; the private method
    // re-checks so it can never be called with an unverifiable request.
    if (!timestamp || !signature) throw new UnauthorizedException('Unauthorized');
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store || (store as any).kind === 'NATIVE' || (store as any).status === 'DISCONNECTED') {
      throw new UnauthorizedException('Unauthorized');
    }
    const secrets = (await this.stores.loadSecrets(storeId)) ?? {};
    const secret = String((secrets as any).webhookSecret ?? '');
    if (!secret) throw new UnauthorizedException('Unauthorized');

    const phonePart = phone ?? '';
    const ipPart = ip ?? '';
    const expected = createHmac('sha256', secret)
      .update(`${phonePart}.${ipPart}.${timestamp}`)
      .digest('hex');
    if (!safeEqual(signature, expected)) {
      throw new UnauthorizedException('Unauthorized');
    }

    // Read-only from here: three reads, zero writes.
    const reasons: string[] = [];
    if (ipPart) {
      const hit = await this.blockedEntries.findOrderBlockedIp(ipPart);
      if (hit) reasons.push('ip_blocked');
    }
    const normalized = phonePart ? normalizePhone(phonePart) : null;
    if (normalized) {
      const hit = await this.blockedEntries.findBlockedPhone(normalized);
      if (hit) reasons.push('phone_blocked');
      const suspended = await this.customers.isPhoneBlocked(normalized);
      if (suspended) reasons.push('account_suspended');
    }
    return { blocked: reasons.length > 0, reasons };
  }
}
