import { IsIn, IsString } from 'class-validator';

export const LEAD_TRIAGE_STATUSES = ['CONTACTED', 'CLOSED'] as const;

export class UpdateLeadStatusDto {
  @IsString()
  @IsIn([...LEAD_TRIAGE_STATUSES])
  status!: 'CONTACTED' | 'CLOSED';
}
