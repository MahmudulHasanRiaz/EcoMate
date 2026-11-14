import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
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
}
