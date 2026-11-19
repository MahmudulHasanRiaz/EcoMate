import { IsInt, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AdjustBalanceDto {
  /** Emails to add (positive) or remove (negative, FEFO). Never 0. */
  @IsInt()
  delta!: number;

  /** Why the operator is adjusting (operator error only — audited). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
