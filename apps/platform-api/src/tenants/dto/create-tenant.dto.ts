import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/, {
    message:
      'slug must be 3–30 lowercase letters, numbers or hyphens, starting and ending with a letter or number',
  })
  slug!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  ownerEmail!: string;

  @IsOptional()
  @IsString()
  ownerPhone?: string;

  @IsOptional()
  @IsUUID()
  planVersionId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  trialDays?: number;

  /**
   * Owner password for the tenant workspace. When provided, the tenant is
   * provisioned immediately (same flow as a verified public signup: a
   * synthetic VERIFIED signup request is created and the provisioning job
   * runs synchronously so the caller gets the definitive outcome). When
   * omitted, the tenant is created unprovisioned, as before.
   */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  ownerPassword?: string;
}
