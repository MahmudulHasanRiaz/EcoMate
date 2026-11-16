import { IsBoolean, IsOptional } from 'class-validator';

export class CancelTenantDto {
  /**
   * true (default): keep access until the current period ends, then cancel.
   * false: cancel immediately.
   */
  @IsOptional()
  @IsBoolean()
  atPeriodEnd?: boolean;
}
