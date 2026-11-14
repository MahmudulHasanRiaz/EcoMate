import { SetMetadata } from '@nestjs/common';

export const PLATFORM_ROLES_KEY = 'platform_roles';

export const Roles = (...roles: string[]) =>
  SetMetadata(PLATFORM_ROLES_KEY, roles);
