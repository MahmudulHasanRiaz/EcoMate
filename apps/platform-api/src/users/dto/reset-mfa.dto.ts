import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for POST /users/:id/mfa/reset (Phase 4 unification — the old
 * `totp/reset` body, carried over verbatim). The reason is audit
 * metadata only.
 */
export class ResetMfaDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
