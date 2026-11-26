import { IsInt, Max, Min } from 'class-validator';

/** Body for PATCH /settings/organization-limit (D12). Console UI range
 * 1–100; the server clamp is [1, 1000] (see organization-limit.ts). */
export class UpdateOrganizationLimitSettingsDto {
  @IsInt()
  @Min(1)
  @Max(100)
  limit!: number;
}
