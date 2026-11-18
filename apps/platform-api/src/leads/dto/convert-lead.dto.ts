import { IsUUID } from 'class-validator';

/** Convert-lead-to-tenant (C1): link a Won lead to its tenant. */
export class ConvertLeadDto {
  @IsUUID()
  tenantId!: string;
}
