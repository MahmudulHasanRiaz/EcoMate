import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateStorageSettingsDto {
  @IsOptional()
  @IsIn(['local', 'r2'])
  driver?: 'local' | 'r2';

  /**
   * Local volume root override. Null clears the stored path (falls
   * back to MEDIA_LOCAL_PATH env / default). Changing the path hides
   * files stored under the previous path until switched back.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  localPath?: string | null;
}
