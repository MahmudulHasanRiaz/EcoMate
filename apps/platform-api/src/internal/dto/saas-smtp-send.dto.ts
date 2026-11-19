import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class SaasSmtpSendDto {
  @IsUUID()
  tenantId!: string;

  @IsEmail()
  to!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  subject!: string;

  @IsOptional()
  @IsString()
  html?: string;

  @IsOptional()
  @IsString()
  text?: string;

  /** BullMQ job id — the idempotency reference for the consume. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reference!: string;

  /** Tenant's configured from address, used as Reply-To. */
  @IsOptional()
  @IsEmail()
  replyTo?: string;
}
