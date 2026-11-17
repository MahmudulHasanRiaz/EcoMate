import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  BRANDING_IMAGE_MAX_LENGTH,
  BRANDING_IMAGE_URL_PATTERN,
} from '../branding-url';

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

  // http(s) URL or data:image/* URL (uploaded logo, stored as a data URL).
  @IsOptional()
  @ValidateIf((o) => o.logoUrl !== '')
  @Matches(BRANDING_IMAGE_URL_PATTERN, {
    message: 'logoUrl must be an http(s) URL or a data:image/* URL',
  })
  @MaxLength(BRANDING_IMAGE_MAX_LENGTH)
  logoUrl?: string;

  @IsOptional()
  @ValidateIf((o) => o.faviconUrl !== '')
  @Matches(BRANDING_IMAGE_URL_PATTERN, {
    message: 'faviconUrl must be an http(s) URL or a data:image/* URL',
  })
  @MaxLength(BRANDING_IMAGE_MAX_LENGTH)
  faviconUrl?: string;
}
