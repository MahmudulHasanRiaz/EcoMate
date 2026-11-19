import { IsOptional, IsUUID } from 'class-validator';

/**
 * Lead assignment (Batch 2, item 12). assignedToId null (or omitted)
 * unassigns the lead. The service validates the assignee is an ACTIVE
 * operator in a triage role — a DISABLED user or a READONLY user is
 * not assignable.
 */
export class AssignLeadDto {
  @IsOptional()
  @IsUUID()
  assignedToId?: string | null;
}
