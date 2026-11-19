import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { SAAS_SMTP_FREE_ALLOWANCE_MAX } from '../../email-balance/email-balance.utils';

export class UpdateSaasSmtpExpiryDto {
  @IsOptional()
  @IsIn(['NONE', 'FIXED_DAYS', 'END_OF_PERIOD'])
  mode?: 'NONE' | 'FIXED_DAYS' | 'END_OF_PERIOD';

  @IsOptional()
  @IsInt()
  @Min(1)
  days?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  warnDays?: number;
}

export class UpdateSaasSmtpSettingsDto {
  @IsOptional()
  @IsIn(['PER_EMAIL', 'PER_1000'])
  unit?: 'PER_EMAIL' | 'PER_1000';

  /**
   * BDT per unit. null clears the rate (top-ups disabled until a rate is
   * set again); omitted keeps the stored value. @IsOptional skips both
   * null and undefined, so null reaches the service as "clear".
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  pricePerUnit?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SAAS_SMTP_FREE_ALLOWANCE_MAX)
  freeAllowance?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lowBalanceThreshold?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateSaasSmtpExpiryDto)
  expiry?: UpdateSaasSmtpExpiryDto;
}
