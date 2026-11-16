import { IsString, IsUUID, Matches } from 'class-validator';

export class TenantDataDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/)
  slug!: string;
}
