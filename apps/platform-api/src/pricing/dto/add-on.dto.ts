import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PricingMeteringDto } from './pricing-document.dto';

export class CreateAddOnDto {
  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/, {
    message:
      'slug must be 3–60 lowercase letters, numbers or hyphens, starting and ending with a letter or number',
  })
  slug!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY', 'CUSTOM'])
  interval?: 'MONTHLY' | 'YEARLY' | 'CUSTOM';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsObject()
  limits?: Record<string, number>;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => PricingMeteringDto)
  metering?: PricingMeteringDto;
}

export class UpdateAddOnDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY', 'CUSTOM'])
  interval?: 'MONTHLY' | 'YEARLY' | 'CUSTOM';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsObject()
  limits?: Record<string, number>;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => PricingMeteringDto)
  metering?: PricingMeteringDto | null;
}

export class AttachAddOnDto {
  @IsOptional()
  @IsIn(['immediate', 'next_period'])
  effectiveAt?: 'immediate' | 'next_period';
}

export class DetachAddOnDto {
  @IsOptional()
  @IsIn(['immediate', 'next_period'])
  effectiveAt?: 'immediate' | 'next_period';
}

export class ConvertFeatureDto {
  @IsString()
  featureKey!: string;

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
