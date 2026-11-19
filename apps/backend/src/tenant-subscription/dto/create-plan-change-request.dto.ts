import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePlanChangeRequestDto {
  @IsUUID()
  targetPlanId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
