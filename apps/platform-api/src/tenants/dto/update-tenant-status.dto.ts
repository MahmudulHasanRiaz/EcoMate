import { IsIn, IsOptional, IsString } from 'class-validator';

export const TENANT_STATUSES = [
  'PENDING_VERIFICATION',
  'PROVISIONING',
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
  'DELETED',
] as const;

export class UpdateTenantStatusDto {
  @IsIn(TENANT_STATUSES)
  status!: (typeof TENANT_STATUSES)[number];

  @IsOptional()
  @IsString()
  reason?: string;
}
