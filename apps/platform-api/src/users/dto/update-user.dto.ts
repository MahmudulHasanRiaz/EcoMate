import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PlatformRoleDto, PlatformStatusDto } from './create-user.dto';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(PlatformRoleDto)
  role?: PlatformRoleDto;

  @IsOptional()
  @IsEnum(PlatformStatusDto)
  status?: PlatformStatusDto;
}
