import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';

export class UpdateCouponDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
