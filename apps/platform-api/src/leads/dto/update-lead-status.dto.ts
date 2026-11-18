import { IsIn, IsString } from 'class-validator';

/** All statuses a lead can be triaged INTO (NEW is entry-only). */
export const LEAD_TRIAGE_STATUSES = [
  'CONTACTED',
  'QUALIFIED',
  'DEMO_SCHEDULED',
  'WON',
  'LOST',
  'CLOSED',
] as const;

export type LeadTriageStatus = (typeof LEAD_TRIAGE_STATUSES)[number];

export class UpdateLeadStatusDto {
  @IsString()
  @IsIn([...LEAD_TRIAGE_STATUSES])
  status!: LeadTriageStatus;
}
