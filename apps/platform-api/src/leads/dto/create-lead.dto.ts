import {
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

  /** Cloudflare Turnstile token. Optional — never required (see LeadsService). */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  turnstileToken?: string;
}
