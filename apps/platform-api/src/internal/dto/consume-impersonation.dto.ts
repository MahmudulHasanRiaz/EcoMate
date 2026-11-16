import { IsString, IsUUID, Length, Matches } from 'class-validator';

export class ConsumeImpersonationDto {
  @IsString()
  @Length(64, 64)
  @Matches(/^[0-9a-f]+$/i)
  token!: string;

  @IsUUID()
  tenantId!: string;
}
