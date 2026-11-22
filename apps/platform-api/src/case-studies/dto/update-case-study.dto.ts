import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { MediaFieldsDto } from '../../common/media/media.dto';
import {
  CASE_STUDY_MAX_SEO_DESCRIPTION_LENGTH,
  CASE_STUDY_MAX_SEO_TITLE_LENGTH,
  CASE_STUDY_MAX_SLUG_LENGTH,
  CASE_STUDY_MAX_TITLE_LENGTH,
  CASE_STUDY_MAX_URL_LENGTH,
  CASE_STUDY_SLUG_PATTERN,
} from '../case-studies.constants';
import {
  IsMetricLines,
  type CaseStudyMetricLine,
} from './create-case-study.dto';

/**
 * Partial update. The slug CAN change (unlike a LandingContent key —
 * a case study is renamed by slug, and the old URL simply 404s after
 * the rename); a slug that collides with another study is a 409.
 * Empty-string URL/SEO fields clear the value (the console sends ''
 * for a cleared field); undefined leaves it alone. Media fields come
 * from MediaFieldsDto (an omitted field keeps the stored value).
 */
export class UpdateCaseStudyDto extends MediaFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(CASE_STUDY_MAX_TITLE_LENGTH)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CASE_STUDY_MAX_SLUG_LENGTH)
  @Matches(CASE_STUDY_SLUG_PATTERN, {
    message:
      'slug must be lowercase letters, digits and hyphens (e.g. dhaka-fashion-house)',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  client?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  businessType?: string;

  @IsOptional()
  @IsString()
  problem?: string;

  @IsOptional()
  @IsString()
  solution?: string;

  @IsOptional()
  @IsString()
  outcome?: string;

  @IsOptional()
  @IsArray()
  @IsMetricLines()
  metrics?: CaseStudyMetricLine[];

  @IsOptional()
  @IsString()
  @MaxLength(CASE_STUDY_MAX_URL_LENGTH)
  featuredImageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CASE_STUDY_MAX_URL_LENGTH)
  videoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CASE_STUDY_MAX_URL_LENGTH)
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CASE_STUDY_MAX_SEO_TITLE_LENGTH)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CASE_STUDY_MAX_SEO_DESCRIPTION_LENGTH)
  seoDescription?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
