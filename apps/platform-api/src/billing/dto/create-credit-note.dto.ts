import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateCreditNoteDto {
  @IsUUID()
  tenantId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999_999_999)
  amount!: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsString()
  @Length(3, 500)
  reason!: string;

  @IsOptional()
  @IsUUID()
  appliedInvoiceId?: string;
}
