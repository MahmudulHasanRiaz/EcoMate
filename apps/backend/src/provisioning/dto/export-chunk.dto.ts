import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { TenantDataDto } from './tenant-data.dto';

export class ExportChunkDto extends TenantDataDto {
  /** Tenant-scoped table name (validated against the catalog on the server). */
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9_]*$/)
  table!: string;

  /** ctid cursor from the previous chunk (`(block,item)`); omit for page 1. */
  @IsOptional()
  @IsString()
  @Matches(/^\(\d+,\d+\)$/)
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;
}
