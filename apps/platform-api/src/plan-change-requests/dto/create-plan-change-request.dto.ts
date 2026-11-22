import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Internal create body (tenant backend → platform). The tenant id comes
 * from the path, never the body; requestedBy is the tenant user id from
 * the backend JWT, forwarded by the trusted backend caller.
 */
export class CreatePlanChangeRequestDto {
  @IsUUID()
  targetPlanId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  requestedBy?: string;

  /**
   * Trial conversion review (trial-end design 2026-11-22): the add-on
   * ids the tenant chose to KEEP. Omitted = no add-on choice (plain
   * plan change). The service validates every id against the tenant's
   * attached trial add-ons.
   */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  addOnIds?: string[];
}
