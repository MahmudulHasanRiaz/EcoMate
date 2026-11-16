import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateBrandingSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  platformName?: string;

  // Empty string clears the value; a non-empty value must be valid.
  // Plain @IsOptional would reject '' (neither null nor undefined).
  @IsOptional()
  @ValidateIf((o) => o.supportEmail !== '')
  @IsEmail()
  @MaxLength(255)
  supportEmail?: string;

  @IsOptional()
  @ValidateIf((o) => o.logoUrl !== '')
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(1000)
  logoUrl?: string;
}
