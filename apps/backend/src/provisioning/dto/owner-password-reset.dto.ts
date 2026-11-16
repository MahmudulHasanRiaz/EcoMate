import { IsEmail, IsString, IsUUID, Matches } from 'class-validator';

export class OwnerPasswordResetDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/)
  slug!: string;

  @IsEmail()
  email!: string;
}
