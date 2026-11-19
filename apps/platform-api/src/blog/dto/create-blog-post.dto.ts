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
import {
  BLOG_MAX_GALLERY_URLS,
  BLOG_POST_STATUSES,
  BLOG_SLUG_PATTERN,
} from '../blog.constants';

export class CreateBlogPostDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  titleEn!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  titleBn!: string;

  /**
   * Optional — auto-generated from titleEn (with a -2, -3, … suffix on
   * clash) when omitted. An explicit slug that clashes with a live
   * post is a 409.
   */
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

  /** Tiptap HTML. */
  @IsString()
  @MinLength(1)
  contentEn!: string;

  /** Tiptap HTML. Empty = English-only post for now. */
  @IsOptional()
  @IsString()
  contentBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  author?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /**
   * URL string, not @IsUrl: media-library URLs may be relative
   * (/api/public/media/:id) as well as absolute.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  featuredImageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  videoUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BLOG_MAX_GALLERY_URLS)
  @IsString({ each: true })
  @MaxLength(2048, { each: true })
  galleryUrls?: string[];

  /** Minutes. Auto-computed from contentEn when omitted. */
  @IsOptional()
  @IsInt()
  @Min(1)
  readTime?: number;

  @IsOptional()
  @IsIn([...BLOG_POST_STATUSES])
  status?: string;

  /**
   * Required when status is 'scheduled' (enforced in the service —
   * a scheduled post with no publish time can never go live).
   * Auto-set to now when status is 'published' and this is omitted.
   */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  publishedAt?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  seoTitleEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  seoTitleBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seoDescEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  seoDescBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  canonicalUrl?: string;

  /** Tag ids to attach (all must exist). */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  tagIds?: string[];
}
