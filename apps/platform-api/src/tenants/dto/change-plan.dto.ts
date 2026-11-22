import { IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';

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

  /**
   * Trial conversion (trial-end design 2026-11-22): the add-on ids the
   * tenant chose to KEEP in the conversion review. Undefined = no
   * add-on choice (plain plan change — trial add-ons untouched).
   * Defined (possibly empty) = confirm the kept trial-granted add-ons
   * and end the dropped ones, and include the kept add-ons' fees in
   * the conversion invoice. Ids that are not attached trial add-ons
   * are ignored. Applied immediately even with effectiveAt
   * next_period — the choice is recorded now, billing starts at the
   * deferred renewal.
   */
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  keepAddOnIds?: string[];
}
