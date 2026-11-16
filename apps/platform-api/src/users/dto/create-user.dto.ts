import {
  IsEmail,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum PlatformRoleDto {
  SUPERADMIN = 'SUPERADMIN',
  BILLING = 'BILLING',
  SUPPORT = 'SUPPORT',
  READONLY = 'READONLY',
}

export enum PlatformStatusDto {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

/** Minimum platform password length — same rule as the platform seed. */
export const PLATFORM_MIN_PASSWORD_LENGTH = 12;

export class CreateUserDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsEnum(PlatformRoleDto)
  role!: PlatformRoleDto;

  @IsString()
  @MinLength(PLATFORM_MIN_PASSWORD_LENGTH)
  @MaxLength(200)
  password!: string;
}
