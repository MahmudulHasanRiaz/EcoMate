import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MediaFieldsDto } from '../../common/media/media.dto';
import {
  IsMetricLines,
  type CaseStudyMetricLine,
} from '../../case-studies/dto/create-case-study.dto';
import {
  CLIENT_REVIEW_FORMATS,
  CLIENT_REVIEW_MAX_QUOTE_LENGTH,
  CLIENT_REVIEW_MAX_SORT_ORDER,
  CLIENT_REVIEW_MAX_URL_LENGTH,
  CLIENT_REVIEW_STATUSES,
  CLIENT_REVIEW_VIDEO_PROVIDERS,
} from '../client-reviews.constants';

/** Review metrics are the same `{ stat, label }` lines as case studies. */
export type ClientReviewMetricLine = CaseStudyMetricLine;

export class CreateClientReviewDto extends MediaFieldsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reviewerName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  role?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  companyName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(CLIENT_REVIEW_MAX_QUOTE_LENGTH)
  quoteEn!: string;

  /** Empty = English-only for now (BlogPost.contentBn pattern). */
  @IsOptional()
  @IsString()
  @MaxLength(CLIENT_REVIEW_MAX_QUOTE_LENGTH)
  quoteBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CLIENT_REVIEW_MAX_URL_LENGTH)
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CLIENT_REVIEW_MAX_URL_LENGTH)
  logoUrl?: string;

  /** 1–5 stars; omitted = not given (never 0). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

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

  /** Display duration of the primary video, "M:SS" (may be ""). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^(|\d{1,3}:\d{2})$/, {
    message: 'videoDuration must be empty or "M:SS" (e.g. 2:41)',
  })
  videoDuration?: string;

  @IsOptional()
  @IsUUID()
  caseStudyId?: string;

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
