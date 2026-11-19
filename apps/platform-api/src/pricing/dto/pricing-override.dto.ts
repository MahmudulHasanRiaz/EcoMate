import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class SetPricingOverrideDto {
  @IsString()
  @IsIn(['per_order_rate', 'minimum_monthly'])
  key!: string;

  /** BDT. 0 for minimum_monthly means "no floor". */
  @IsNumber()
  @Min(0)
  value!: number;

  @IsOptional()
  @IsString()
  note?: string;
}
