import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class AddDomainDto {
  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9.-]{1,251}[a-z0-9])$/, {
    message: 'host must be a valid lower-case hostname',
  })
  host!: string;

  @IsOptional()
  @IsIn(['SUBDOMAIN', 'CUSTOM'])
  type?: 'SUBDOMAIN' | 'CUSTOM';
}
