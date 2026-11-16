import { IsString, MaxLength, MinLength } from 'class-validator';
import { PLATFORM_MIN_PASSWORD_LENGTH } from '../../users/dto/create-user.dto';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(PLATFORM_MIN_PASSWORD_LENGTH)
  @MaxLength(200)
  newPassword!: string;
}
