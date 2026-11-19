import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { IsJsonObjectOrString } from './create-landing-content.dto';

/**
 * Partial update. section/key/locale are the row's identity (the unique
 * constraint) and cannot change — to rename, delete and re-create.
 *
 * Optimistic locking (CMS batch 2, item 17): `expectedVersion` is
 * REQUIRED — the version the editor loaded. Missing → 400; stale →
 * 409 whose body carries `currentVersion` and `changedKeys` (the
 * top-level keys that differ between the value at the expected
 * version — or the submitted value when no snapshot of it exists —
 * and the current stored value). A successful edit bumps `version`
 * and leaves the row a draft; edits never auto-publish.
 */
export class UpdateLandingContentDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsJsonObjectOrString()
  value?: unknown;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
