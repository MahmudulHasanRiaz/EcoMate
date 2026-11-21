import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { RequestMethod } from '@nestjs/common';
// These constants are NOT exported from '@nestjs/common' itself in Nest 11
// (importing them from the root yields undefined); the constants subpath is
// the source of truth ('path', 'method', '__guards__').
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { PLATFORM_ROLES_KEY } from './roles.decorator';
import { ROLE_MATRIX } from '../users/role-matrix';

/**
 * Authorization coverage: fails when any non-public handler lacks @Roles(),
 * when any guarded controller forgets PlatformAuthGuard, or when the
 * published role matrix disagrees with the @Roles() annotations.
 *
 * This spec DISCOVERS controllers by scanning src/ for *.controller.ts, so
 * a new controller is checked automatically — there is no list to forget
 * to update. The only way a handler escapes the @Roles() requirement is an
 * explicit entry in the allowlists below, with a reason.
 */

const SRC_DIR = path.resolve(__dirname, '..');

/** Whole controllers that are public or service-token guarded by design. */
const PUBLIC_CONTROLLERS: Record<string, string> = {
  SignupController: 'public self-serve signup (Turnstile + rate limits)',
  PublicLeadsController:
    'public lead capture (per-IP rate limit + verify-if-present Turnstile; low-privilege record)',
  PublicLandingContentController:
    'public landing content for the landing page (active rows only, cacheable)',
  PublicPlansController: 'public plan catalogue for the landing page',
  PublicBrandingController:
    'public branding for the console login page (platform name + logo/favicon URLs only, no tenant data)',
  PublicBlogController:
    'public blog for the landing (published posts only, cacheable)',
  PublicCaseStudiesController:
    'public case studies for the landing (published studies only, cacheable)',
  PublicMediaController:
    'public media bytes for the landing (logos/landing images rendered for anonymous visitors; SVG sanitized at upload + sandbox CSP; the library itself is authenticated)',
  HealthController: 'liveness probe, no data',
  PrometheusMetricsController:
    'Prometheus scrape endpoint (Phase 8 Stage 2) — operational metrics only, no tenant data; restricted to the private network in production',
  InternalController: 'service-token guard (InternalServiceGuard)',
  InternalDomainsController:
    'service-token guard (InternalServiceGuard) — tenant self-service domains (custom-domains subagent)',
  InternalPlanChangeRequestsController:
    'service-token guard (InternalServiceGuard) — tenant self-service plan-change requests (Subscription hub)',
  TlsAskController: 'Caddy-only ask endpoint, token query param',
};

/**
 * Handlers that intentionally carry no @Roles(): public credential
 * endpoints, invite accept, and own-profile / own-MFA actions (the matrix
 * grants every role "login and own profile"). Each entry names the guard
 * the handler MUST carry instead — an allowlisted handler with no guard
 * at all still fails.
 */
const HANDLERS_WITHOUT_ROLES: Record<string, { reason: string; guard: string | null }> = {
  'AuthController.login': {
    reason: 'public credential endpoint (global rate limit + lockout)',
    guard: null,
  },
  'AuthController.refresh': {
    reason: 'public token rotation (valid refresh token required)',
    guard: null,
  },
  'AuthController.logout': {
    reason: 'public token revocation (valid refresh token required)',
    guard: null,
  },
  'AuthController.me': { reason: 'own profile', guard: 'PlatformAuthGuard' },
  'AuthController.changePassword': {
    reason: 'own profile',
    guard: 'PlatformAuthGuard',
  },
  'MfaController.challenge': {
    reason: 'login second step (short-lived MFA token required)',
    guard: null,
  },
  'MfaController.status': {
    reason: 'own MFA status',
    guard: 'PlatformAuthGuard',
  },
  'MfaController.setup': {
    reason: 'own MFA setup (session or MFA token)',
    guard: 'MfaPendingGuard',
  },
  'MfaController.verify': {
    reason: 'own MFA setup verify (session or MFA token)',
    guard: 'MfaPendingGuard',
  },
  'MfaController.disable': {
    reason: 'own MFA disable',
    guard: 'PlatformAuthGuard',
  },
  'MfaController.regenerate': {
    reason: 'own MFA recovery codes',
    guard: 'PlatformAuthGuard',
  },
  'UsersController.accept': {
    reason: 'public invite accept (72h hashed token required)',
    guard: null,
  },
};

/** Matrix area -> controllers whose handlers implement it. Billing jobs are
 * the billing lifecycle jobs, so JobsController is checked under Billing. */
const AREA_CONTROLLERS: Record<string, string[]> = {
  Tenants: ['TenantsController'],
  Billing: ['BillingController', 'JobsController'],
  Plans: ['PlansController'],
  Domains: ['DomainsAdminController'],
  Usage: ['UsageController'],
  Metrics: ['MetricsController'],
  Settings: ['SettingsController'],
  Users: ['UsersController'],
  Audit: ['AuditController'],
  Leads: ['LeadsController'],
  Landing: ['LandingContentController'],
  Media: ['MediaController'],
};

interface HandlerInfo {
  controller: string;
  method: string;
  httpMethod: RequestMethod;
  path: string;
  roles: string[];
  guards: string[];
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
        Reflect.getMetadata(PLATFORM_ROLES_KEY, Controller) ?? [];
      const classGuards: any[] =
        Reflect.getMetadata(GUARDS_METADATA, Controller) ?? [];
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
          Reflect.getMetadata(PLATFORM_ROLES_KEY, fn) ?? classRoles;
        const guards: any[] = [
          ...classGuards,
          ...(Reflect.getMetadata(GUARDS_METADATA, fn) ?? []),
        ];
        handlers.push({
          controller: Controller.name,
          method: name,
          httpMethod,
          path: `/${prefix}/${subPath}`.replace(/\/+/g, '/'),
          roles: [...roles],
          guards: guards.map((g) => g?.name ?? String(g)),
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
    expect(controllers).toEqual([
      'AdDispatchController',
      'AddOnsController',
      'AuditController',
      'AuthController',
      'BillingController',
      'BlogController',
      'CaseStudiesController',
      'DomainsAdminController',
      'EmailBalanceController',
      'EmailBalanceOverviewController',
      'FeaturesController',
      'HealthController',
      'InternalController',
      'InternalDomainsController',
      'InternalPlanChangeRequestsController',
      'JobsController',
      'LandingCacheController',
      'LandingContentController',
      'LeadsController',
      'MediaController',
      'MetricsController',
      'MfaController',
      'PlanChangeRequestsController',
      'PlansController',
      'PricingController',
      'PrometheusMetricsController',
      'PublicBlogController',
      'PublicBrandingController',
      'PublicCaseStudiesController',
      'PublicLandingContentController',
      'PublicLeadsController',
      'PublicMediaController',
      'PublicPlansController',
      'SearchController',
      'SettingsController',
      'SignupController',
      'TenantsController',
      'TlsAskController',
      'UsageController',
      'UsersController',
    ]);
    expect(handlers.length).toBeGreaterThan(60);
  });

  it('every non-public handler carries @Roles()', () => {
    const missing: string[] = [];
    for (const h of handlers) {
      if (PUBLIC_CONTROLLERS[h.controller]) continue;
      if (HANDLERS_WITHOUT_ROLES[`${h.controller}.${h.method}`]) continue;
      if (h.roles.length === 0) {
        missing.push(`${h.controller}.${h.method} (${h.path})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every non-public handler is behind PlatformAuthGuard (or its named guard)', () => {
    const unguarded: string[] = [];
    for (const h of handlers) {
      if (PUBLIC_CONTROLLERS[h.controller]) continue;
      const allowed = HANDLERS_WITHOUT_ROLES[`${h.controller}.${h.method}`];
      if (allowed) {
        if (
          allowed.guard &&
          !h.guards.includes(allowed.guard)
        ) {
          unguarded.push(
            `${h.controller}.${h.method} must carry ${allowed.guard}`,
          );
        }
        continue;
      }
      if (!h.guards.includes('PlatformAuthGuard')) {
        unguarded.push(`${h.controller}.${h.method} (${h.path})`);
      }
      if (!h.guards.includes('RolesGuard')) {
        unguarded.push(
          `${h.controller}.${h.method} (${h.path}) is missing RolesGuard`,
        );
      }
    }
    expect(unguarded).toEqual([]);
  });

  it('the role matrix covers exactly the four roles and all twelve areas', () => {
    expect(ROLE_MATRIX.map((r) => r.role).sort()).toEqual([
      'BILLING',
      'READONLY',
      'SUPERADMIN',
      'SUPPORT',
    ]);
    const areas = Object.keys(AREA_CONTROLLERS).sort();
    for (const entry of ROLE_MATRIX) {
      expect(entry.capabilities.map((c) => c.area).sort()).toEqual(areas);
    }
  });

  it('READONLY is login-and-own-profile only, in the matrix and the code', () => {
    const entry = ROLE_MATRIX.find((r) => r.role === 'READONLY')!;
    expect(entry.description).toMatch(/own profile/i);
    expect(entry.capabilities.every((c) => c.access === 'none')).toBe(true);
    const violations = handlers.filter((h) => h.roles.includes('READONLY'));
    expect(violations.map((h) => `${h.controller}.${h.method}`)).toEqual([]);
  });

  it('the matrix agrees with the @Roles() annotations end to end', () => {
    const byController = new Map<string, HandlerInfo[]>();
    for (const h of handlers) {
      const list = byController.get(h.controller) ?? [];
      list.push(h);
      byController.set(h.controller, list);
    }
    const failures: string[] = [];
    for (const entry of ROLE_MATRIX) {
      for (const cap of entry.capabilities) {
        const areaHandlers = (AREA_CONTROLLERS[cap.area] ?? []).flatMap(
          (c) => byController.get(c) ?? [],
        );
        const withRole = areaHandlers.filter((h) =>
          h.roles.includes(entry.role),
        );
        const gets = withRole.filter(
          (h) => h.httpMethod === RequestMethod.GET,
        );
        const writes = withRole.filter(
          (h) => h.httpMethod !== RequestMethod.GET,
        );
        const areaGets = areaHandlers.filter(
          (h) => h.httpMethod === RequestMethod.GET,
        );
        const areaWrites = areaHandlers.filter(
          (h) => h.httpMethod !== RequestMethod.GET,
        );
        if (cap.access === 'none' && withRole.length > 0) {
          failures.push(
            `${entry.role} / ${cap.area}: matrix says none, but ${withRole
              .map((h) => `${h.controller}.${h.method}`)
              .join(', ')} allow it`,
          );
        }
        if (cap.access === 'read') {
          if (writes.length > 0) {
            failures.push(
              `${entry.role} / ${cap.area}: matrix says read-only, but ${writes
                .map((h) => `${h.controller}.${h.method}`)
                .join(', ')} are writes`,
            );
          }
          if (areaGets.length > 0 && gets.length === 0) {
            failures.push(
              `${entry.role} / ${cap.area}: matrix says read, but no GET allows it`,
            );
          }
        }
        if (cap.access === 'write' || cap.access === 'full') {
          if (areaGets.length > 0 && gets.length === 0) {
            failures.push(
              `${entry.role} / ${cap.area}: matrix says ${cap.access}, but no GET allows it`,
            );
          }
          if (areaWrites.length > 0 && writes.length === 0) {
            failures.push(
              `${entry.role} / ${cap.area}: matrix says ${cap.access}, but no write allows it`,
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
