import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MediaFieldsDto } from '../../common/media/media.dto';
import { IsMetricLines } from '../../case-studies/dto/create-case-study.dto';
import {
  CLIENT_REVIEW_FORMATS,
  CLIENT_REVIEW_MAX_QUOTE_LENGTH,
  CLIENT_REVIEW_MAX_SORT_ORDER,
  CLIENT_REVIEW_MAX_URL_LENGTH,
  CLIENT_REVIEW_STATUSES,
  CLIENT_REVIEW_VIDEO_PROVIDERS,
} from '../client-reviews.constants';
import type { ClientReviewMetricLine } from './create-client-review.dto';

/**
 * Partial update. Every field is optional; `caseStudyId: null` /
 * `rating: null` clear the link / the rating. Empty-string URL fields
 * clear the value (the console sends '' for a cleared field);
 * undefined leaves it alone. Media fields follow the shared fragment
 * (an omitted field keeps the stored value).
 */
export class UpdateClientReviewDto extends MediaFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reviewerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CLIENT_REVIEW_MAX_QUOTE_LENGTH)
  quoteEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CLIENT_REVIEW_MAX_QUOTE_LENGTH)
  quoteBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CLIENT_REVIEW_MAX_URL_LENGTH)
  websiteUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(CLIENT_REVIEW_MAX_URL_LENGTH)
  logoUrl?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number | null;

  @IsOptional()
  @IsArray()
  @IsMetricLines()
  metrics?: ClientReviewMetricLine[];

  @IsOptional()
  @IsIn([...CLIENT_REVIEW_FORMATS])
  format?: string;

  @IsOptional()
  @IsIn([...CLIENT_REVIEW_VIDEO_PROVIDERS])
  videoProvider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^(|\d{1,3}:\d{2})$/, {
    message: 'videoDuration must be empty or "M:SS" (e.g. 2:41)',
  })
  videoDuration?: string;

  @IsOptional()
  @IsUUID()
  caseStudyId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(CLIENT_REVIEW_MAX_SORT_ORDER)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsIn([...CLIENT_REVIEW_STATUSES])
  status?: string;
}
