import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class UpdateLandingSettingsDto {
  @IsOptional()
  @IsIn(['en', 'bn'])
  defaultLocale?: 'en' | 'bn';

  @IsOptional()
  @IsBoolean()
  seoIndexingEnabled?: boolean;
}
