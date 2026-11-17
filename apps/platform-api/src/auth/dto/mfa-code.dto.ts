import { IsString, MaxLength, MinLength } from 'class-validator';

/** A 6-digit TOTP code or an 11-char recovery code (dashes/spaces allowed). */
export class MfaCodeDto {
  @IsString()
  @MinLength(6)
  @MaxLength(16)
  code!: string;
}
