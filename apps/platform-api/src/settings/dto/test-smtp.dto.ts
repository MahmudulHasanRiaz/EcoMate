import { IsEmail, MaxLength } from 'class-validator';

export class TestSmtpDto {
  @IsEmail()
  @MaxLength(255)
  to!: string;
}
