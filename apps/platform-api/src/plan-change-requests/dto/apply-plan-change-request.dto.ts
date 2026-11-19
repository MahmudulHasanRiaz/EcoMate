import { IsIn, IsOptional } from 'class-validator';

/** Mirrors ChangePlanDto.effectiveAt: immediate (default) switches now,
 * next_period records a pending change the renewal job applies at
 * period end. */
export class ApplyPlanChangeRequestDto {
  @IsOptional()
  @IsIn(['immediate', 'next_period'])
  effectiveAt?: 'immediate' | 'next_period';
}
