import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SubmitProofDto {
  @IsUUID()
  invoiceId!: string;

  @IsUUID()
  methodId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999_999_999)
  amount!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(100)
  transactionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  senderNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
