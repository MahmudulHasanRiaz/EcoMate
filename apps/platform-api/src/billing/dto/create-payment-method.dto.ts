import {
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

export enum PaymentMethodTypeDto {
  BKASH = 'BKASH',
  NAGAD = 'NAGAD',
  ROCKET = 'ROCKET',
  BANK = 'BANK',
  MANUAL = 'MANUAL',
}

export class CreatePaymentMethodDto {
  @IsEnum(PaymentMethodTypeDto)
  type!: PaymentMethodTypeDto;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

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
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
