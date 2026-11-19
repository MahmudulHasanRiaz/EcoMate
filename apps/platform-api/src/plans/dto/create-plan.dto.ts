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
import { PricingDocumentDto } from '../../pricing/dto/pricing-document.dto';

export class CreatePlanDto {
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

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  badge?: string;

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
  @IsInt()
  @Min(1)
  intervalDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  trialDays?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsObject()
  limits?: Record<string, number>;

  @IsOptional()
  @IsInt()
  @Min(0)
  graceDays?: number;

  /**
   * Structured pricing document (§3). When supplied, price is derived
   * from pricing.baseFee.amount and the billing cycle from
   * pricing.billingCycle (an explicitly supplied interval that disagrees
   * with the cycle is a 400). When omitted, the document is built from
   * price/interval (fixed-price plan).
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => PricingDocumentDto)
  pricing?: PricingDocumentDto;
}
