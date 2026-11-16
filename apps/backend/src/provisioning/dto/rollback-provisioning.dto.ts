import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class RollbackProvisioningDto {
  @IsUUID()
  tenantId!: string;

  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/)
  slug!: string;
}
