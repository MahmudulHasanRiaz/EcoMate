import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaymentMethodTypeDto } from './create-payment-method.dto';

export class UpdatePaymentMethodDto {
  @IsOptional()
  @IsEnum(PaymentMethodTypeDto)
  type?: PaymentMethodTypeDto;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  // Empty string clears the value; a non-empty value must be a valid URL.
  @IsOptional()
  @ValidateIf((o) => o.qrMediaUrl !== '')
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(1000)
  qrMediaUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
