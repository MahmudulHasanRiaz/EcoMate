import { SetMetadata } from '@nestjs/common';

export const SKIP_SUBSCRIPTION_KEY = 'skip_subscription';
export const SkipSubscription = () =>
  SetMetadata(SKIP_SUBSCRIPTION_KEY, true);
