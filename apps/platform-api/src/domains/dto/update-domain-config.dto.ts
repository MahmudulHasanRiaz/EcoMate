import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

// Keep in sync with DomainConfigService's HOSTNAME_RE. The empty-allowed
// variant is for clearable fields: '' means "clear back to derived".
const HOSTNAME_PATTERN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;
const HOSTNAME_OR_EMPTY_PATTERN = /^$|^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;

export class UpdateDomainConfigDto {
  @IsOptional()
  @IsString()
  @Matches(HOSTNAME_PATTERN)
  primaryDomain?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Matches(HOSTNAME_PATTERN, { each: true })
  baseDomains?: string[];

  /**
   * Parent domain of the console/API hosts. '' clears it (legacy
   * single-domain mode). When set it must be fully separate from the
   * tenant domain — the service enforces the separation.
   */
  @IsOptional()
  @IsString()
  @Matches(HOSTNAME_OR_EMPTY_PATTERN)
  appDomain?: string;

  /**
   * Full landing origin override (verification emails). '' clears the
   * override (derive from the landing host). Shape-checked by the
   * service (must be a valid http(s) URL).
   */
  @IsOptional()
  @IsString()
  landingUrl?: string;

  /**
   * Full console origin override (invite links). '' clears the override
   * (derive from the console host). Shape-checked by the service.
   */
  @IsOptional()
  @IsString()
  adminUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(HOSTNAME_OR_EMPTY_PATTERN)
  fallbackDomain?: string;

  @IsOptional()
  @IsString()
  @Matches(HOSTNAME_OR_EMPTY_PATTERN)
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
