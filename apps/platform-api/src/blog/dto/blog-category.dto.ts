import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BLOG_SLUG_PATTERN } from '../blog.constants';

export class CreateBlogCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameBn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descBn?: string;

  /** Optional — auto-generated from nameEn when omitted. */
  @IsOptional()
  @MaxLength(120)
  @Matches(BLOG_SLUG_PATTERN, {
    message:
      'slug must be lowercase letters, digits and single hyphens (no leading/trailing hyphen)',
  })
  slug?: string;

  /** Null/omitted = root category. */
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateBlogCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descEn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descBn?: string | null;

  @IsOptional()
  @MaxLength(120)
  @Matches(BLOG_SLUG_PATTERN, {
    message:
      'slug must be lowercase letters, digits and single hyphens (no leading/trailing hyphen)',
  })
  slug?: string;

  /** Null moves the category to the root. Cycles are rejected (400). */
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
