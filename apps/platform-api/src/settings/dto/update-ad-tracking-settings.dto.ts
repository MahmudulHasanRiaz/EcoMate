import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { LeadStatus } from '../../generated/prisma/client';
import type { AdTrackingMode } from '../settings.service';

/**
 * Per-platform ad tracking update (CMS batch 2, item 21). Partial:
 * omitted fields keep their stored value. accessToken omitted = keep
 * the stored token; an empty string clears it. The token is never
 * returned by any read (see SettingsService.getAdTracking).
 */
export class UpdateAdTrackingSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  pixelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  accessToken?: string;

  @IsOptional()
  @IsIn(['instant', 'validated'])
  mode?: AdTrackingMode;

  @IsOptional()
  @IsIn(Object.values(LeadStatus))
  triggerStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  eventName?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
