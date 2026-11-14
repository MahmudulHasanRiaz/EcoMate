import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface PlatformRequestUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export const CurrentPlatformUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PlatformRequestUser | undefined =>
    context.switchToHttp().getRequest().platformUser,
);
