import { SetMetadata } from '@nestjs/common';
import { LimitKey } from './limit-keys';

export const REQUIRES_LIMIT_KEY = 'requires_limit';

export interface RequiresLimitMetadata {
  key: LimitKey;
  /** Units consumed by one request; 0 means "block once the limit is reached". */
  amount?: number;
}

export const RequiresLimit = (key: LimitKey, amount = 1) =>
  SetMetadata(REQUIRES_LIMIT_KEY, { key, amount } satisfies RequiresLimitMetadata);
