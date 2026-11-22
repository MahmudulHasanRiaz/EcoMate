import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import {
  MEDIA_DURATION_PATTERN,
  MEDIA_MAX_ALT_LENGTH,
  MEDIA_MAX_CAPTION_LENGTH,
  MEDIA_MAX_GALLERY_IMAGES,
  MEDIA_MAX_URL_LENGTH,
  MEDIA_MAX_VIDEOS,
  MEDIA_MAX_VIDEO_TITLE_LENGTH,
  coerceGalleryEntry,
} from './media.constants';

/**
 * Shared media class-validator decorators (landing-cms-media-design.md
 * §6.1), in the style of the existing `IsMetricLines`.
 *
 * SHAPE ONLY — these decorators deliberately do NOT enforce URL policy
 * (https-or-relative, playable-video kind). Only the service knows the
 * previous row, and an unchanged legacy URL is grandfathered there
 * (media.dto.ts normalizeMediaFields); a decorator that rejected http://
 * would block saving any pre-backfill row that still carries one.
 * What these decorators enforce: non-empty strings, length caps, array
 * caps, entry shape, and the duration pattern — a 400 with a
 * field-named message, never a stored malformed row.
 */

/** Non-empty, whitespace-free string within the URL length cap. */
export function IsMediaUrl(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMediaUrl',
      target: (object as any).constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' &&
            value.trim().length > 0 &&
            value.length <= MEDIA_MAX_URL_LENGTH &&
            !/\s/.test(value)
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a non-empty URL of at most ${MEDIA_MAX_URL_LENGTH} characters`;
        },
      },
    });
  };
}

function isGalleryEntryShape(
  entry: unknown,
  kind: 'image' | 'video',
): boolean {
  const coerced = coerceGalleryEntry(entry, kind);
  if (!coerced) return false;
  if (coerced.url.length > MEDIA_MAX_URL_LENGTH) return false;
  if (/\s/.test(coerced.url)) return false;
  if (kind === 'image') {
    const image = coerced as { alt?: string; caption?: string };
    if (image.alt !== undefined && image.alt.length > MEDIA_MAX_ALT_LENGTH) {
      return false;
    }
    if (
      image.caption !== undefined &&
      image.caption.length > MEDIA_MAX_CAPTION_LENGTH
    ) {
      return false;
    }
    return true;
  }
  const video = coerced as { title?: string; duration?: string };
  if (
    video.title !== undefined &&
    video.title.length > MEDIA_MAX_VIDEO_TITLE_LENGTH
  ) {
    return false;
  }
  if (
    video.duration !== undefined &&
    !MEDIA_DURATION_PATTERN.test(video.duration)
  ) {
    return false;
  }
  return true;
}

/**
 * Image gallery: an array of at most 20 entries; each entry is a
 * plain URL string or a `{ url, alt?, caption? }` object.
 */
export function IsMediaImageArray(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMediaImageArray',
      target: (object as any).constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (!Array.isArray(value)) return false;
          if (value.length > MEDIA_MAX_GALLERY_IMAGES) return false;
          return value.every((entry) =>
            isGalleryEntryShape(entry, 'image'),
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be an array of at most ${MEDIA_MAX_GALLERY_IMAGES} image entries ({ url, alt?, caption? }) with non-empty URLs`;
        },
      },
    });
  };
}

/**
 * Video gallery: an array of at most 10 entries; each entry is a
 * plain URL string or a `{ url, title?, duration? }` object, with
 * duration "M:SS" when present.
 */
export function IsMediaVideoArray(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMediaVideoArray',
      target: (object as any).constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (!Array.isArray(value)) return false;
          if (value.length > MEDIA_MAX_VIDEOS) return false;
          return value.every((entry) =>
            isGalleryEntryShape(entry, 'video'),
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be an array of at most ${MEDIA_MAX_VIDEOS} video entries ({ url, title?, duration? }) with non-empty URLs and durations like "2:41"`;
        },
      },
    });
  };
}
