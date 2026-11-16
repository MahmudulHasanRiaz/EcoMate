import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class UpdateDomainConfigDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i)
  primaryDomain?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  baseDomains?: string[];

  @IsOptional()
  @IsString()
  fallbackDomain?: string;

  @IsOptional()
  @IsString()
  customDomainCname?: string;

  @IsOptional()
  @IsBoolean()
  allowExternalFallback?: boolean;

  @IsOptional()
  @IsBoolean()
  primaryHealthy?: boolean;

  @IsOptional()
  @IsObject()
  platformHosts?: Record<string, string>;
}
