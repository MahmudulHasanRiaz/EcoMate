import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateSmtpSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsBoolean()
  secure?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  user?: string;

  /** Omit to keep the stored password; an explicit value replaces it. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pass?: string;

  // Empty string clears the value (falls back to PLATFORM_MAIL_FROM);
  // a non-empty value must be a valid email. Plain @IsOptional would
  // reject '' because it is neither null nor undefined.
  @IsOptional()
  @ValidateIf((o) => o.from !== '')
  @IsEmail()
  @MaxLength(255)
  from?: string;

  /** Display name for outgoing mail ("EcoMate" in "EcoMate <a@b>"). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fromName?: string;
}
