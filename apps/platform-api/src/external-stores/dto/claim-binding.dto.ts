import { IsIn, IsOptional, IsString, Length, Matches, MaxLength, IsUUID } from 'class-validator';

/** Provider slugs for the platform binding (Phase 9). NATIVE is not a provider. */
export const STORE_PROVIDERS = ['WOOCOMMERCE', 'SHOPIFY', 'CUSTOM'] as const;
export type StoreProviderSlug = (typeof STORE_PROVIDERS)[number];

/**
 * Claim a platform binding for a pre-generated storeId (Phase 9 §3.4).
 * The tenant backend calls this BEFORE inserting its Store row; on
 * failure it calls release. The fingerprint is the tenant-independent
 * identity (sha256 of kind | providerStoreId | normalised domain, from
 * the backend's store-identity) — it is what makes the claim global.
 */
export class ClaimBindingDto {
  /** Pre-generated UUID — the SAME id the tenant DB Store row will carry. */
  @IsUUID()
  storeId!: string;

  @IsUUID()
  tenantId!: string;

  @IsIn(STORE_PROVIDERS)
  provider!: StoreProviderSlug;

  /** Provider-side store id (e.g. the Shopify myshopify_domain). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerStoreId?: string;

  /** Already-normalised shop domain (lowercase, no scheme/www). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  domainNormalised?: string;

  /** sha256 hex (64 chars) — the global identity of the store. */
  @IsString()
  @Length(64, 64)
  @Matches(/^[0-9a-f]+$/i)
  identityFingerprint!: string;
}
