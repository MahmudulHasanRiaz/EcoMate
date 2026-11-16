import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateCouponDto {
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9-]{2,29}$/, {
    message: 'code must be 3–30 letters, numbers or hyphens',
  })
  code!: string;

  @IsIn(['PERCENT', 'FIXED'])
  type!: 'PERCENT' | 'FIXED';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999_999_999)
  value!: number;

  @IsIn(['ONCE', 'FOREVER', 'MONTHS'])
  duration!: 'ONCE' | 'FOREVER' | 'MONTHS';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  durationMonths?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  planIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
