import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateSmtpSettingsDto {
  @IsOptional()
  @IsIn(['BYO', 'SAAS'])
  mode?: 'BYO' | 'SAAS';

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
  @IsString()
  @MaxLength(255)
  username?: string;

  /**
   * Write-only, never returned. An explicit value replaces the stored
   * password; an empty string clears it; omitted keeps it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  password?: string;

  @IsOptional()
  @IsIn(['NONE', 'STARTTLS', 'SSL'])
  encryption?: 'NONE' | 'STARTTLS' | 'SSL';

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  fromEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fromName?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
