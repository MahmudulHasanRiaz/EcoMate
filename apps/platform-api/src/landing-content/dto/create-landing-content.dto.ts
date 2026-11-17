import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  Matches,
  MaxLength,
  Min,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import {
  LANDING_KEY_PATTERN,
  LANDING_LOCALES,
  LANDING_SECTIONS,
} from '../landing-content.constants';

/**
 * A landing value is a JSON string (hero/contact scalar fields) or a
 * JSON object (capability / faq / testimonial / partner item). Arrays
 * and null are rejected at the top level — a list section is N rows,
 * never one array-valued row.
 */
export function IsJsonObjectOrString(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isJsonObjectOrString',
      target: (object as any).constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value === 'string') return true;
          return (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value)
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a JSON object or a string`;
        },
      },
    });
  };
}

export class CreateLandingContentDto {
  @IsIn([...LANDING_SECTIONS])
  section!: string;

  @MaxLength(80)
  @Matches(LANDING_KEY_PATTERN, {
    message:
      'key must start with a letter or number, then letters, numbers or hyphens (hero/contact keys are the landing field names, e.g. headlinePart1)',
  })
  key!: string;

  @IsIn([...LANDING_LOCALES])
  locale!: string;

  @IsNotEmpty()
  @IsJsonObjectOrString()
  value!: unknown;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
