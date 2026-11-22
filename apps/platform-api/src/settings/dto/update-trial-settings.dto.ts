import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { TRIAL_END_POLICIES } from '../settings.service';

export class UpdateTrialSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  graceDays?: number;

  /**
   * Add-on slugs a new trial includes (trial-plan signups only).
   * null (or omitted) = unset: every active add-on except custom-domain.
   * [] = a trial with no add-ons. Unknown/inactive slugs are ignored at
   * attach time. Changing this affects NEW signups only.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  trialAddOnSlugs?: string[] | null;

  /** What happens when a trial-plan trial ends. Default grace_then_suspend. */
  @IsOptional()
  @IsIn(TRIAL_END_POLICIES)
  trialEndPolicy?: (typeof TRIAL_END_POLICIES)[number];
}
