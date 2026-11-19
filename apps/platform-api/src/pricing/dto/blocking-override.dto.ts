import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';

export class SetBlockingOverrideDto {
  @IsString()
  @IsIn(['grace_then_block', 'block_immediately'])
  mode!: string;

  @IsArray()
  @IsString({ each: true })
  blockedAreas!: string[];

  @IsOptional()
  @IsString()
  note?: string;
}
