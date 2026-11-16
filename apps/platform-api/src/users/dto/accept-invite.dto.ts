import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PLATFORM_MIN_PASSWORD_LENGTH } from './create-user.dto';

export class AcceptInviteDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsString()
  @MinLength(PLATFORM_MIN_PASSWORD_LENGTH)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;
}
