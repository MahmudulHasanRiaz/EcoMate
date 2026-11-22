/**
 * Provider registry — central-commerce §7 (P1).
 *
 * Mirrors `tracking/adapters` and `marketing/provider-factory`: all three
 * slugs are registered in P1. `providerFor(store)` returns the adapter for
 * the store's kind and THROWS for `kind === 'NATIVE'` (BR-20 — enforced by
 * a throwing guard, not by convention). Core services branch on
 * `ProviderCapabilities`, never on a provider slug.
 */
import { Injectable, BadRequestException, OnModuleInit, Optional } from '@nestjs/common';
import type { CommerceProvider, ProviderSlug } from './provider.contract';
import { WooCommerceProvider } from './woocommerce.provider';
import { ShopifyProvider } from './shopify.provider';
import { CustomBridgeProvider } from './custom-bridge.provider';
import { ProviderUrlGuard } from './provider-url-guard';
import type { BaseCommerceProvider } from './base-provider';

export const NATIVE_STORE_KIND = 'NATIVE';

export const PROVIDER_KIND_MAP: Record<ProviderSlug, string> = {
  woocommerce: 'WOOCOMMERCE',
  shopify: 'SHOPIFY',
  custom: 'CUSTOM',
};

@Injectable()
export class ProviderRegistryService implements OnModuleInit {
  private readonly providers: Record<ProviderSlug, CommerceProvider>;

  constructor(
    wooCommerce: WooCommerceProvider,
    shopify: ShopifyProvider,
    customBridge: CustomBridgeProvider,
    // @Optional so unit specs constructing the registry manually (3 args)
    // keep working; production always wires the guard via StoresModule.
    @Optional() private readonly urlGuard?: ProviderUrlGuard,
  ) {
    this.providers = {
      woocommerce: wooCommerce,
      shopify: shopify,
      custom: customBridge,
    };
  }

  /**
   * Phase 9 §3.7: wrap every adapter's injectable fetchFn with the SSRF
   * guard (https-only, DNS-validated, redirect-re-validated). All three
   * adapters extend BaseCommerceProvider, so `wrapFetchFn` exists on
   * each — the `typeof` check is defence-in-depth, not a branch on
   * slugs. Contract specs construct providers directly (no registry
   * init), so their MockFetch seams are untouched.
   */
  onModuleInit(): void {
    if (!this.urlGuard) return;
    for (const provider of Object.values(this.providers)) {
      const base = provider as unknown as Partial<BaseCommerceProvider>;
      if (typeof base.wrapFetchFn === 'function') {
        base.wrapFetchFn((inner) => this.urlGuard!.wrapFetch(inner));
      }
    }
  }

  /** All registered provider slugs. */
  slugs(): ProviderSlug[] {
    return Object.keys(this.providers) as ProviderSlug[];
  }

  /**
   * Resolve the adapter for a store. BR-20: NATIVE is not a provider —
   * the native website is never targeted by external sync.
   */
  providerFor(store: { kind: string }): CommerceProvider {
    if (store.kind === NATIVE_STORE_KIND) {
      throw new BadRequestException(
        'NATIVE store is not a sync provider target (BR-20)',
      );
    }
    const entry = Object.entries(PROVIDER_KIND_MAP).find(
      ([, kind]) => kind === store.kind,
    );
    if (!entry) {
      throw new BadRequestException(`Unknown store kind: ${store.kind}`);
    }
    return this.providers[entry[0] as ProviderSlug];
  }

  providerBySlug(slug: ProviderSlug): CommerceProvider {
    const provider = this.providers[slug];
    if (!provider) {
      throw new BadRequestException(`Unknown provider slug: ${slug}`);
    }
    return provider;
  }
}
