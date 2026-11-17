import { IsString, MaxLength, MinLength } from 'class-validator';

export class MfaChallengeDto {
  @IsString()
  @MinLength(10)
  mfaToken!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(16)
  code!: string;
}
