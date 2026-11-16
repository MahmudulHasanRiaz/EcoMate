import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class ProvisionTenantDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/)
  slug!: string;

  @IsString()
  @MaxLength(80)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  ownerEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  ownerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  ownerName?: string;

  /** bcrypt hash produced by the platform signup (never the plaintext). */
  @IsString()
  @Matches(/^\$2[aby]\$/)
  passwordHash!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  canonicalDomain?: string;
}
