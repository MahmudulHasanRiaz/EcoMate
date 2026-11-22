import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { MediaFieldsDto } from '../../common/media/media.dto';
import {
  CASE_STUDY_MAX_METRICS,
  CASE_STUDY_MAX_SEO_DESCRIPTION_LENGTH,
  CASE_STUDY_MAX_SEO_TITLE_LENGTH,
  CASE_STUDY_MAX_SLUG_LENGTH,
  CASE_STUDY_MAX_TITLE_LENGTH,
  CASE_STUDY_MAX_URL_LENGTH,
  CASE_STUDY_SLUG_PATTERN,
} from '../case-studies.constants';

export interface CaseStudyMetricLine {
  stat: string;
  label: string;
}

/**
 * Metrics are `stat | label` lines — the same shape as testimonial
 * metrics: an array of at most 6 objects, each with a non-empty stat
 * and label. Anything else is a 400, never a stored malformed row.
 */
export function IsMetricLines(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMetricLines',
      target: (object as any).constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (!Array.isArray(value)) return false;
          if (value.length > CASE_STUDY_MAX_METRICS) return false;
          return value.every(
            (line) =>
              typeof line === 'object' &&
              line !== null &&
              !Array.isArray(line) &&
              typeof (line as { stat?: unknown }).stat === 'string' &&
              ((line as { stat: string }).stat.trim().length > 0) &&
              typeof (line as { label?: unknown }).label === 'string' &&
              ((line as { label: string }).label.trim().length > 0),
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be an array of at most ${CASE_STUDY_MAX_METRICS} { stat, label } lines with non-empty strings`;
        },
      },
    });
  };
}

/**
 * Media: the six shared fields come from MediaFieldsDto. The legacy
 * featuredImageUrl / videoUrl stay accepted (an old client may still
 * send them) — the service derives the new media from them, and
 * dual-writes them from the new media when new fields are present.
 */
export class CreateCaseStudyDto extends MediaFieldsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(CASE_STUDY_MAX_TITLE_LENGTH)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(CASE_STUDY_MAX_SLUG_LENGTH)
  @Matches(CASE_STUDY_SLUG_PATTERN, {
    message:
      'slug must be lowercase letters, digits and hyphens (e.g. dhaka-fashion-house)',
  })
  slug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  client!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  businessType!: string;

  @IsString()
  @IsNotEmpty()
  problem!: string;

  @IsString()
  @IsNotEmpty()
  solution!: string;

  @IsString()
  @IsNotEmpty()
  outcome!: string;

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
