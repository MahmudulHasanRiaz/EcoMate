import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SettingsService } from './settings.service';

/**
 * Platform control-plane maintenance. When enabled, non-GET requests are
 * refused with 503, except:
 * - auth (login/refresh must keep working, or nobody can turn it off),
 * - health,
 * - internal registry/entitlement endpoints the backend polls,
 * - settings itself (SUPERADMIN turns maintenance off from the console).
 * Reads always pass. Tenant-plane storefront maintenance is separate and
 * untouched by this guard.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly settings: SettingsService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      method?: string;
      url?: string;
    }>();
    const method = (request.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true;
    }
    const path = (request.url ?? '').split('?')[0];
    if (
      path.startsWith('/api/auth') ||
      path.startsWith('/api/health') ||
      path.startsWith('/api/internal') ||
      path.startsWith('/api/settings')
    ) {
      return true;
    }
    if (this.settings.isMaintenanceEnabled()) {
      const message = this.settings.getMaintenance().message;
      throw new ServiceUnavailableException(
        message
          ? `Platform is under maintenance: ${message}`
          : 'Platform is under maintenance. Please try again later.',
      );
    }
    return true;
  }
}
