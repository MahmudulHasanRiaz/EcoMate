import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * class-validator shape for the pricing document (design §3). The strict
 * whitelist (unknown keys rejected) is enforced by
 * validatePricingDocument in the service — the global ValidationPipe
 * strips unknown keys on DTOs, but the pricing doc is also accepted as
 * plain JSON in places, so the pure validator is the source of truth.
 */
export class PricingBaseFeeDto {
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;
}

export class PricingMeteringDto {
  @IsString()
  @IsIn(['orders_per_month'])
  metric!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  included?: number;

  @IsNumber()
  @Min(0)
  ratePerUnit!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumMonthly?: number | null;
}

export class OneTimeFeeEffectDto {
  @IsString()
  @IsIn(['setup', 'limit_increase', 'rate_tier', 'feature_unlock'])
  type!: string;

  @IsOptional()
  @IsObject()
  limits?: Record<string, number>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  perOrderRate?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];
}

export class OneTimeFeeDto {
  @IsString()
  key!: string;

  @IsString()
  label!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @ValidateNested()
  @Type(() => OneTimeFeeEffectDto)
  effect!: OneTimeFeeEffectDto;
}

export class PricingBlockingDto {
  @IsOptional()
  @IsIn(['grace_then_block', 'block_immediately'])
  mode?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockedAreas?: string[];
}

export class PricingDocumentDto {
  @IsOptional()
  @IsInt()
  pricingVersion?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => PricingBaseFeeDto)
  baseFee?: PricingBaseFeeDto;

  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY', 'WEEKLY_7D'])
  billingCycle?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  freeMonths?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => PricingMeteringDto)
  metering?: PricingMeteringDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OneTimeFeeDto)
  oneTimeFees?: OneTimeFeeDto[];

  @IsOptional()
  @IsObject()
  overLimit?: Record<string, string>;

  @IsOptional()
  @ValidateNested()
  @Type(() => PricingBlockingDto)
  blocking?: PricingBlockingDto;
}
