import { IsBoolean, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

/**
 * POST /features/:key/convert-to-addon body. The feature key comes from
 * the URL — unlike ConvertFeatureDto (POST /add-ons/from-feature, where
 * the key is typed in the body), this DTO has no featureKey field.
 */
export class ConvertToAddOnDto {
  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
