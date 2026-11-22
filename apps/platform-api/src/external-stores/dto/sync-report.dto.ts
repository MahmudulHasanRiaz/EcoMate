import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Sync-health report from the tenant backend (Phase 9 §6.2): the
 * backend calls this on sync completion so the console's External
 * Stores panel can show last sync / last error without another hop.
 * lastSyncAt defaults to now when omitted; lastError clears when
 * sent as null (a successful sync) and is untouched when omitted.
 */
export class SyncReportDto {
  @IsOptional()
  @IsDateString()
  lastSyncAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  lastError?: string | null;
}
