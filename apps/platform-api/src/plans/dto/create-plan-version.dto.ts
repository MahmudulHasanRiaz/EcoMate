import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { PricingDocumentDto } from '../../pricing/dto/pricing-document.dto';

export class CreatePlanVersionDto {
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
   * from pricing.baseFee.amount. When omitted, the previous version's
   * pricing is inherited (with baseFee re-pointed at the new price, so
   * price and pricing.baseFee.amount can never drift).
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => PricingDocumentDto)
  pricing?: PricingDocumentDto;
}
