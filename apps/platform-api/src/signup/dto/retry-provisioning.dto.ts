import { IsString, Length, Matches } from 'class-validator';

export class RetryProvisioningDto {
  @IsString()
  @Length(64, 64)
  @Matches(/^[0-9a-f]+$/i)
  token!: string;
}
