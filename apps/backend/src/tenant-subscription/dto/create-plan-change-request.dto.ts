import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreatePlanChangeRequestDto {
  @IsUUID()
  targetPlanId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /**
   * Trial conversion review (trial-end design 2026-11-22): the add-on
   * ids the tenant chose to KEEP. Omitted = no add-on choice (plain
   * plan change). The platform validates every id against the tenant's
   * attached trial add-ons.
   */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  addOnIds?: string[];
}
