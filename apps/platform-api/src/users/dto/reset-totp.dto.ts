import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Body for POST /users/:id/totp/reset. The reason is audit metadata only. */
export class ResetTotpDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
