import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MediaFieldsDto } from '../../common/media/media.dto';
import {
  BLOG_MAX_GALLERY_URLS,
  BLOG_POST_STATUSES,
  BLOG_SLUG_PATTERN,
} from '../blog.constants';

/**
 * Partial update. Every field is optional; `tagIds` (when present)
 * REPLACES the post's tags wholesale. `categoryId: null` unassigns
 * the category. Slug changes re-check live-slug uniqueness (409).
 * Media fields come from MediaFieldsDto (an omitted field keeps the
 * stored value); the legacy media fields stay accepted for old
 * clients (see CreateBlogPostDto).
 */
export class UpdateBlogPostDto extends MediaFieldsDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  titleEn?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  titleBn?: string;

  @IsOptional()
  @MaxLength(120)
  @Matches(BLOG_SLUG_PATTERN, {
    message:
      'slug must be lowercase letters, digits and single hyphens (no leading/trailing hyphen)',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerptEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerptBn?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  contentEn?: string;

  @IsOptional()
  @IsString()
  contentBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  author?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  featuredImageUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  videoUrl?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BLOG_MAX_GALLERY_URLS)
  @IsString({ each: true })
  @MaxLength(2048, { each: true })
  galleryUrls?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  readTime?: number | null;

  @IsOptional()
  @IsIn([...BLOG_POST_STATUSES])
  status?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  publishedAt?: Date | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  seoTitleEn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  seoTitleBn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seoDescEn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seoDescBn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  canonicalUrl?: string | null;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  tagIds?: string[];
}
