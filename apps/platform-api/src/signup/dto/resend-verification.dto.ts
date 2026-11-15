import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ResendVerificationDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  captchaToken?: string;

  /** Honeypot: must stay empty (bots fill it). */
  @IsOptional()
  @IsString()
  website?: string;
}
