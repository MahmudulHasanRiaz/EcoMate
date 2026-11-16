import { IsInt, IsOptional, Max, Min } from 'class-validator';

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
}
