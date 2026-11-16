import { IsString, Length } from 'class-validator';

export class RejectProofDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}
