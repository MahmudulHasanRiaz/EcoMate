import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { OneTimeFeeEffectDto } from './pricing-document.dto';

/**
 * Sell a one-time fee (design §6). Either `feeKey` (a key in the
 * tenant's version oneTimeFees[]) or a custom fee (label + amount +
 * effect) — Q2 "everything configurable" means custom fees must be
 * possible without a new version. Exactly one of the two.
 */
export class CustomFeeDto {
  @IsString()
  label!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @ValidateNested()
  @Type(() => OneTimeFeeEffectDto)
  effect!: OneTimeFeeEffectDto;
}

export class CreatePurchaseDto {
  @IsOptional()
  @IsString()
  feeKey?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CustomFeeDto)
  custom?: CustomFeeDto;
}
