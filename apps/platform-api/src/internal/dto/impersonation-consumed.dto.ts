import { IsDateString, IsString, IsUUID } from 'class-validator';

/**
 * Body the central auth service POSTs after a successful impersonation
 * consume (`GET /api/better-auth/impersonation/consume`).
 *
 * The handoff row itself lives in the auth service's database — the
 * platform has no new-handoff record — so "record the consumption"
 * means an audit row keyed by `handoffId` (see InternalController).
 * `targetUserId` / `adminUserId` are CENTRAL Better Auth user ids
 * (cuid-shaped, not UUIDs); only `handoffId` (auth-DB row id) and
 * `organizationId` (tenant id == organization id) are UUIDs.
 */
export class ImpersonationConsumedDto {
  @IsUUID()
  handoffId!: string;

  @IsUUID()
  organizationId!: string;

  @IsString()
  targetUserId!: string;

  @IsString()
  adminUserId!: string;

  @IsDateString()
  consumedAt!: string;
}
