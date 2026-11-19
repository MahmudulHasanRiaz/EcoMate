import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** A rejection always carries a reason the tenant can see. Blank
 * (whitespace-only) reasons are rejected in the service. */
export class RejectPlanChangeRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
