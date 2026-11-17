import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { RequestMethod } from '@nestjs/common';
// These constants are NOT exported from '@nestjs/common' itself in Nest 11;
// the constants subpath is the source of truth ('path', 'method').
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import {
  PERMISSIONS_KEY,
  PERMISSIONS_ANY_KEY,
} from '../common/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

/**
 * Authorization coverage: fails when any non-public handler carries neither
 * @Roles() nor @Permissions()/@PermissionsAny().
 *
 * Both guards default-allow when no metadata exists (RolesGuard and
 * PermissionsGuard return true), so a handler without either decorator is
 * reachable by ANY authenticated tenant user — including customers. The
 * only way a handler escapes the requirement is an explicit entry in the
 * allowlists below, with a reason.
 *
 * This spec DISCOVERS controllers by scanning src/ for *.controller.ts, so
 * a new controller is checked automatically — there is no list to forget
 * to update.
 */

const SRC_DIR = path.resolve(__dirname, '..');

/**
 * Whole controllers whose every handler is intentionally open to any
 * authenticated tenant user. Each entry names the reason.
 */
const PUBLIC_CONTROLLERS: Record<string, string> = {
  // Every handler is scoped to @CurrentUser().userId — a user can only read
  // or change their own settings.
  SettingsController: 'own settings, scoped to the current user',
  // Every handler passes @CurrentUser().userId into the service, which
  // scopes every query by userId — a user can only manage their own
  // addresses.
  AddressesController: 'own addresses, scoped to the current user',
};

/**
 * Handlers that intentionally carry no @Roles()/@Permissions(): each entry
 * names the reason. Prefer fixing the handler (adding a decorator) over
 * adding an entry here.
 */
const HANDLERS_WITHOUT_AUTHORIZATION: Record<string, string> = {
  // Own user settings, scoped to @CurrentUser().userId.
  'UsersController.getSettings': 'own settings',
  'UsersController.updateSettings': 'own settings',
  // Returns only the caller's own shopper identity, resolved from their own
  // session (Better Auth user id). No way to ask for another shopper.
  'TrackingController.identity': 'own shopper identity from own session',
  // Own referral, scoped to @CurrentUser().userId.
  'ReferralsController.getMyReferral': 'own referral',
  // Own orders, scoped to @CurrentUser().userId.
  'OrdersController.findMyOrders': 'own orders',
  'OrdersController.findMyOrderById': 'own orders',
  // Own profile / session actions (logout, me, update profile, change
  // password) — any authenticated user manages their own account.
  'AuthController.logout': 'own session',
  'AuthController.me': 'own profile',
  'AuthController.updateProfile': 'own profile',
  'AuthController.changePassword': 'own password',
  // Guarded by MobileBuilderCallbackGuard: a timing-safe shared-secret
  // token (X-Callback-Token vs MOBILE_BUILDER_CALLBACK_TOKEN), fail-closed
  // when the env var is unset. Role/permission metadata does not apply to
  // machine-to-machine callbacks.
  'MobileBuilderController.receiveArtifact': 'callback-token guard',
  'MobileBuilderController.receiveArtifactFromGitHub': 'callback-token guard',
};

interface HandlerInfo {
  controller: string;
  method: string;
  httpMethod: RequestMethod;
  path: string;
  roles: string[];
  permissions: string[];
  isPublic: boolean;
}

function discoverControllers(): HandlerInfo[] {
  const files = fs
    .globSync('**/*.controller.ts', { cwd: SRC_DIR })
    .map((f) => path.join(SRC_DIR, f));
  const handlers: HandlerInfo[] = [];

  for (const file of files) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file);
    const controllers = Object.values(mod).filter(
      (v: any) =>
        typeof v === 'function' && /Controller$/.test(v.name || ''),
    ) as any[];
    expect(controllers.length).toBeGreaterThan(0);
    for (const Controller of controllers) {
      const prefix: string =
        Reflect.getMetadata(PATH_METADATA, Controller) ?? '';
      const classRoles: string[] =
        Reflect.getMetadata(ROLES_KEY, Controller) ?? [];
      const classPermissions: string[] = [
        ...(Reflect.getMetadata(PERMISSIONS_KEY, Controller) ?? []),
        ...(Reflect.getMetadata(PERMISSIONS_ANY_KEY, Controller) ?? []),
      ];
      const classPublic =
        Reflect.getMetadata(IS_PUBLIC_KEY, Controller) === true;
      for (const name of Object.getOwnPropertyNames(Controller.prototype)) {
        if (name === 'constructor') continue;
        const fn = Controller.prototype[name];
        const httpMethod: RequestMethod | undefined = Reflect.getMetadata(
          METHOD_METADATA,
          fn,
        );
        if (httpMethod === undefined) continue;
        const subPath: string =
          Reflect.getMetadata(PATH_METADATA, fn) ?? '';
        const roles: string[] =
          Reflect.getMetadata(ROLES_KEY, fn) ?? classRoles;
        const permissions: string[] = [
          ...(Reflect.getMetadata(PERMISSIONS_KEY, fn) ?? []),
          ...(Reflect.getMetadata(PERMISSIONS_ANY_KEY, fn) ?? []),
          ...classPermissions,
        ];
        const isPublic =
          Reflect.getMetadata(IS_PUBLIC_KEY, fn) === true || classPublic;
        handlers.push({
          controller: Controller.name,
          method: name,
          httpMethod,
          path: `/${prefix}/${subPath}`.replace(/\/+/g, '/'),
          roles: [...roles],
          permissions: [...permissions],
          isPublic,
        });
      }
    }
  }
  return handlers;
}

describe('authorization coverage', () => {
  const handlers = discoverControllers();

  it('discovers every controller in the tree', () => {
    const controllers = [...new Set(handlers.map((h) => h.controller))].sort();
    // If this list grows, the checks below cover the new controller
    // automatically; update this count only when a controller is added or
    // removed on purpose.
    expect(controllers.length).toBeGreaterThan(100);
    expect(handlers.length).toBeGreaterThan(500);
  });

  it('every non-public handler carries @Roles() or @Permissions()', () => {
    const missing: string[] = [];
    for (const h of handlers) {
      if (h.isPublic) continue;
      if (PUBLIC_CONTROLLERS[h.controller]) continue;
      if (HANDLERS_WITHOUT_AUTHORIZATION[`${h.controller}.${h.method}`])
        continue;
      if (h.roles.length === 0 && h.permissions.length === 0) {
        missing.push(`${h.controller}.${h.method} (${h.path})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
