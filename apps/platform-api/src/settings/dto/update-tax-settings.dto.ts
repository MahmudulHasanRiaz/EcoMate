import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateTaxSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  ratePercent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsBoolean()
  inclusive?: boolean;
}
