/**
 * Store webhook receivers — central-commerce P6 (§8.5 webhook path, §8.7).
 *
 * Public, signed, rate-limited:
 *   POST /webhooks/stores/woocommerce/:storeKey
 *   POST /webhooks/stores/shopify/:storeKey
 *   POST /webhooks/stores/custom/:storeKey
 * (global `api` prefix applies → `/api/webhooks/stores/*`, the exact prefix
 * the route-scoped raw-body hook captures for HMAC-over-raw-body.)
 *
 * No domain work inline: verify → dedupe → enqueue → 200 immediately
 * (BR-21). `@Public()` + `@RateLimitPolicy('store_webhook')`, generic errors.
 * No `@RequiresFeature` — like the marketing/courier webhooks, signature
 * verification is the gate (public receivers cannot demand a license feature).
 */
import { Body, Controller, Headers, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SkipTenant } from '../../tenancy/skip-tenant.decorator';
import { SkipSubscription } from '../../tenancy/skip-subscription.decorator';
import { RateLimitPolicy } from '../../common/rate-limit/rate-limit-policy.decorator';
import { StoreWebhookService } from './store-webhook.service';
import type { ProviderSlug } from '../providers/provider.contract';

@Controller('webhooks/stores')
@Public()
@SkipTenant()
// The subscription guard is a global APP_GUARD and getAccessState()
// returns `read_only` with no tenant record — without this a webhook
// POST with no tenant context would 403 ("This workspace is read-only").
// Subscription/entitlement enforcement happens INSIDE the handler after
// tenant resolution (acknowledge-200-without-ingest). Precedent:
// InternalRegistryController carries exactly this combination.
@SkipSubscription()
@RateLimitPolicy('store_webhook')
export class StoreWebhooksController {
  constructor(private readonly intake: StoreWebhookService) {}

  @Post('woocommerce/:storeKey')
  async woocommerce(
    @Param('storeKey') storeKey: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: any,
    @Body() _body: unknown,
  ) {
    void _body;
    return this.receive('woocommerce', storeKey, headers, req);
  }

  @Post('shopify/:storeKey')
  async shopify(
    @Param('storeKey') storeKey: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: any,
    @Body() _body: unknown,
  ) {
    void _body;
    return this.receive('shopify', storeKey, headers, req);
  }

  @Post('custom/:storeKey')
  async custom(
    @Param('storeKey') storeKey: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: any,
    @Body() _body: unknown,
  ) {
    void _body;
    return this.receive('custom', storeKey, headers, req);
  }

  private async receive(
    slug: ProviderSlug,
    storeKey: string,
    headers: Record<string, string | string[] | undefined>,
    req: any,
  ) {
    const rawBody: Buffer | undefined = req?.rawBody;
    // Without the route-scoped capture there is nothing to verify over —
    // fail closed with the same generic error (never a 500 oracle).
    if (!Buffer.isBuffer(rawBody)) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.intake.intake(slug, storeKey, headers, rawBody);
  }
}
