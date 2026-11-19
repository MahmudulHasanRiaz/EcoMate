import { IsDateString, IsOptional } from 'class-validator';

/**
 * Lead follow-up (Batch 2, item 12). followUpAt null (or omitted)
 * clears the follow-up. Past dates are accepted — backdating a
 * follow-up is how an overdue lead is recorded, and the overdue rule
 * (followUpAt < now, terminal statuses excluded) treats it as overdue.
 */
export class UpdateLeadFollowUpDto {
  @IsOptional()
  @IsDateString()
  followUpAt?: string | null;
}
