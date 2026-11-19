import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { classifyContact } from '../lead-contact';

function IsEmailOrPhone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isEmailOrPhone',
      target: (object as any).constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' && classifyContact(value) !== null
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a valid email address or phone number`;
        },
      },
    });
  };
}

export class CreateLeadDto {
  @IsString()
  @Length(2, 100)
  name!: string;

  @IsString()
  @IsEmailOrPhone()
  contact!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  monthlyOrders?: string;

  /**
   * Consent capture (Batch 1, item 8). The form requires the checkbox;
   * the API accepts it as optional so non-form submitters are not
   * broken, but a submitted lead SHOULD carry consentGiven=true with
   * the exact label text shown (consentText) as proof of what was
   * agreed to.
   */
  @IsOptional()
  @IsBoolean()
  consentGiven?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  consentText?: string;

  /** UTM params from the form page URL (Batch 1, item 8). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmCampaign?: string;

  /**
   * Ad attribution capture (CMS batch 2, item 21): Meta browser id /
   * click id / dedup event id, TikTok click id / dedup event id. All
   * optional — the form sends what it has (usually none: no Pixel is
   * loaded on the landing, so _fbp/_fbc cookies rarely exist).
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fbp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fbc?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  eventId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  ttclid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  tiktokEventId?: string;

  /** Cloudflare Turnstile token. Optional — never required (see LeadsService). */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  turnstileToken?: string;
}
