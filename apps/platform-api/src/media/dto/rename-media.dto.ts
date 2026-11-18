import { IsString, MaxLength, MinLength } from 'class-validator';

export class RenameMediaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  originalFilename!: string;
}
