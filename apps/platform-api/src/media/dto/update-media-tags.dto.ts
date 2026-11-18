import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

export class UpdateMediaTagsDto {
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  tags!: string[];
}
