import { IsEmail, IsOptional } from 'class-validator';

export class TestSmtpDto {
  /** Recipient of the real test email. Defaults to the requesting user's email. */
  @IsOptional()
  @IsEmail()
  to?: string;
}
