import { IsNumber, Min } from 'class-validator';

export class CreateTopUpDto {
  /** BDT the tenant pays. The service enforces the real minimum (the price of 1 email at the current rate). */
  @IsNumber()
  @Min(0)
  amountBDT!: number;
}
