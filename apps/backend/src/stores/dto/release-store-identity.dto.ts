import { IsString, IsUUID, Matches } from 'class-validator';

/**
 * Platform → backend force-unbind identity release (Phase 9 §8.2.2).
 * Same shape as the provisioning TenantDataDto: the explicit tenant id +
 * slug the backend runs the release under (the platform is the only
 * caller, authenticated by the service-token guard).
 */
export class ReleaseStoreIdentityDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/)
  slug!: string;
}
