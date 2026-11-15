import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_KEY = 'skip_tenant';

export const SkipTenant = () => SetMetadata(SKIP_TENANT_KEY, true);
