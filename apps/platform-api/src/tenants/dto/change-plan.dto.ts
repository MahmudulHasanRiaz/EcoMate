import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class ChangePlanDto {
  @IsUUID()
  planVersionId!: string;

  /**
   * immediate (default): switch now, credit the unused portion of the
   * current plan, start a new period and invoice the new plan.
   * next_period: record a pending change the renewal job applies at period
   * end — no invoice, no switch yet.
   */
  @IsOptional()
  @IsIn(['immediate', 'next_period'])
  effectiveAt?: 'immediate' | 'next_period';
}
