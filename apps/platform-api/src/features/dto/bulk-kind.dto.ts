import { ArrayMinSize, IsArray, IsIn, IsString } from 'class-validator';

/** POST /features/bulk-kind — mark many features initial/add-on at once. */
export class BulkKindDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  keys!: string[];

  @IsIn(['initial', 'add-on'])
  kind!: 'initial' | 'add-on';
}
