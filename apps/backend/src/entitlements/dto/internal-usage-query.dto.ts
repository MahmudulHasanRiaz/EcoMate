import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Service-to-service usage query. `tenantId` and `slug` are resolved by the
 * platform control plane from its own records; the tenant runtime never trusts
 * a bare header here.
 *
 * Optional `from`/`to` (ISO dates) scope the period counters — the platform
 * billing engine passes the subscription period so 7-day and anniversary
 * cycles bill their exact window instead of the Dhaka calendar month.
 * Backwards compatible: no from/to = current behaviour (calendar month).
 */
export class InternalUsageQueryDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  slug!: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
