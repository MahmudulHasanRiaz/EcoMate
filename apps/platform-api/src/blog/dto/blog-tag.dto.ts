import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BLOG_SLUG_PATTERN } from '../blog.constants';

export class CreateBlogTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nameBn!: string;

  /** Optional — auto-generated from nameEn when omitted. */
  @IsOptional()
  @MaxLength(120)
  @Matches(BLOG_SLUG_PATTERN, {
    message:
      'slug must be lowercase letters, digits and single hyphens (no leading/trailing hyphen)',
  })
  slug?: string;
}

export class UpdateBlogTagDto {
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
  @MaxLength(120)
  @Matches(BLOG_SLUG_PATTERN, {
    message:
      'slug must be lowercase letters, digits and single hyphens (no leading/trailing hyphen)',
  })
  slug?: string;
}
