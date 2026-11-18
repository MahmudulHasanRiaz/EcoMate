import { IsString, MaxLength } from 'class-validator';

export class MoveMediaDto {
  /** '' = library root. */
  @IsString()
  @MaxLength(120)
  folder!: string;
}
