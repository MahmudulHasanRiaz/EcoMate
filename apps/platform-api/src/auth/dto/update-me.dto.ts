import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * PATCH /auth/me — avatar-only for now (name editing is a separate
 * backend decision; the Profile dialog keeps the name read-only).
 *
 * avatarAssetId: a media-library asset id to use as the custom avatar
 * (the API stores the asset's object KEY, never a URL), or null to
 * remove the custom photo (back to Gravatar/initials). Omitted = no
 * change.
 */
export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  avatarAssetId?: string | null;
}
