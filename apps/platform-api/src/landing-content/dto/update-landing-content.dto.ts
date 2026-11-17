import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { IsJsonObjectOrString } from './create-landing-content.dto';

/**
 * Partial update. section/key/locale are the row's identity (the unique
 * constraint) and cannot change — to rename, delete and re-create.
 */
export class UpdateLandingContentDto {
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
