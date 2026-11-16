import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class SetLimitOverrideDto {
  /** Effective limit for this tenant. 0 blocks the first unit. */
  @IsInt()
  @Min(0)
  value!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
