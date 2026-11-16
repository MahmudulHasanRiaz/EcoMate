import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * Service-to-service usage query. `tenantId` and `slug` are resolved by the
 * platform control plane from its own records; the tenant runtime never trusts
 * a bare header here.
 */
export class InternalUsageQueryDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  slug!: string;
}
