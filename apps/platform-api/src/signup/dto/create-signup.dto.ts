import {
  Equals,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { SLUG_PATTERN } from '../signup-slug';

export class CreateSignupDto {
  @IsString()
  @Length(2, 80)
  tenantName!: string;

  @IsString()
  @Matches(SLUG_PATTERN, {
    message:
      'slug must be 3–30 lowercase letters, numbers or hyphens (no leading/trailing hyphen)',
  })
  slug!: string;

  @IsEmail()
  @MaxLength(254)
  ownerEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  ownerPhone?: string;

  // Minimum 12, matching the platform-user minimum
  // (PLATFORM_MIN_PASSWORD_LENGTH) and the landing signup form. The owner
  // account is the tenant's root of trust; 8 was too short.
  @IsString()
  @Length(12, 72)
  password!: string;

  @IsOptional()
  @IsString()
  captchaToken?: string;

  /** Honeypot: must stay empty (bots fill it). */
  @IsOptional()
  @IsString()
  website?: string;

  @IsBoolean()
  @Equals(true, { message: 'You must accept the terms' })
  acceptTerms!: boolean;
}
