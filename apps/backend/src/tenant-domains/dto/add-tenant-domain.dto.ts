import { IsString, Matches } from 'class-validator';

export class AddTenantDomainDto {
  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9.-]{1,251}[a-z0-9])$/, {
    message: 'host must be a valid lower-case hostname',
  })
  host!: string;
}
