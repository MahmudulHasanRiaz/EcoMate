// Better Auth options builder - pure: no Prisma client import, no env reads.
// Split out of src/auth.ts so `npx auth generate` can load these exact
// options with a scratch adapter (memory) without importing the production
// Prisma client (which does not exist until `prisma generate` runs).
// The schema this produces is therefore the schema the service boots with.
import { randomBytes } from 'node:crypto';
import type { BetterAuthOptions } from 'better-auth';
import { verifyPassword } from 'better-auth/crypto';
import { organization } from 'better-auth/plugins/organization';
import { admin } from 'better-auth/plugins/admin';
import { defaultStatements as adminDefaultStatements } from 'better-auth/plugins/admin/access';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { createAccessControl } from 'better-auth/plugins/access';
import {
  adminAc,
  defaultStatements,
  ownerAc,
} from 'better-auth/plugins/organization/access';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { APIError } from '@better-auth/core/error';
import { createHMAC } from '@better-auth/utils/hmac';
import bcrypt from 'bcryptjs';
import type { AuthServiceConfig } from './config.js';
import type { Mailer } from './mailer.js';
import type { PrismaClient } from './generated/prisma/index.js';
import {
  makeOrganizationLimitChecker,
} from './org-limits.js';
import { createImpersonationHandoffPlugin } from './impersonation-handoff.js';
import { getFakeIdpEmail } from './test-fake-idp.js';
import type { TenantRegistry } from './tenant-registry.js';

// ---------------------------------------------------------------------------
// Organization roles (D11=A dynamic access control; D4=A staff only members)
// ---------------------------------------------------------------------------
// The org-plugin defaults (owner/admin/member) are insufficient for EcoMate:
// tenant staff roles are owner, admin, cashier, packing_assistant, employee
// (the backend UserRole enum minus `customer` — customers are plain users,
// never org members). Owner = full control; admin = everything except org
// delete; staff roles = membership only (coarse gates — the backend's
// computeEffectivePermissions stays authoritative for permissions, and
// AccessPreset maps to per-org organizationRole rows in Phase 2).
const statement = createAccessControl(defaultStatements);
const staffRole = statement.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ['read'],
});

// ---------------------------------------------------------------------------
// Admin plugin roles (Q7 — narrow custom role map, design §1.4)
// ---------------------------------------------------------------------------
// "operator" may ONLY impersonate. No role may list/ban/delete/set-role/
// set-password/revoke. "admin" is deliberately NOT defined: a user row
// with role "admin" authorizes nothing (fail-closed — has-permission.mjs
// resolves roles via the map; an unknown role string authorizes nothing).
// adminUserIds is NEVER set: has-permission.mjs grants EVERY admin
// permission to any id listed there, bypassing roles entirely.
// Break-glass recovery is a direct DB update of user.role per runbook.
const adminAccess = createAccessControl(adminDefaultStatements);
const operatorRole = adminAccess.newRole({
  user: ['impersonate'],
  session: [],
});
const plainUserRole = adminAccess.newRole({ user: [], session: [] });

// Trust-device cookie name (twoFactor plugin constant —
// plugins/two-factor/constant.mjs; NOT an exported subpath, so the literal
// is used here with the source cited). Trust-device max age is the plugin
// default: 2592e3 s (30 days, plugins/two-factor/index.mjs).
const TRUST_DEVICE_COOKIE_NAME = 'trust_device';
const TRUST_DEVICE_MAX_AGE = 2592e3;

export function buildAuthOptions(deps: {
  config: AuthServiceConfig;
  database: BetterAuthOptions['database'];
  mailer: Mailer;
  /** Prisma client for org-limit counting + handoff rows. Undefined only
   * in the schema-generation context (auth-generate.config.ts), where no
   * request ever runs — the org-limit checker then fails closed. */
  prisma?: PrismaClient | null;
  /**
   * Live platform tenant registry (Phase 3 swap). Null when the
   * platform-api is not reachable from this service (no
   * AUTH_PLATFORM_API_URL / INTERNAL_SERVICE_SECRET) — trustedOrigins
   * then stays on the config allowlist alone and the consume host
   * check stays on the Phase 1 rules. Undefined only in the
   * schema-generation context.
   */
  registry?: TenantRegistry | null;
}): BetterAuthOptions {
  const { config, database, mailer, prisma, registry } = deps;

  return {
    // Top-level appName sets the TOTP issuer (spike-proven: without it the
    // issuer falls back to "Better Auth"). Matches the console's current
    // otpauth issuer "EcoMate".
    appName: 'EcoMate',
    secret: config.secret,
    // Dynamic baseURL, NO fallback (Q1 decided: omit — fail closed).
    // Unknown hosts throw BetterAuthError; the HTTP server wraps the
    // handler and answers 500 without killing the process (Phase 0 crash
    // finding). Do NOT add a fallback host.
    baseURL: {
      allowedHosts: config.allowedHosts,
      protocol: config.baseProtocol,
    },
    basePath: '/api/better-auth',
    // TrustedOrigins — Phase 3 registry swap (survey §11). The origin
    // is trusted iff its host is EITHER in the config allowlist
    // (AUTH_TRUSTED_HOSTS: platform hosts + dev hosts) OR in the live
    // platform tenant registry (tenant subdomains + VERIFIED/ACTIVE
    // custom domains, fetched from GET /internal/tenants/registry and
    // cached 60 s — see src/tenant-registry.ts). The allowlist stays as
    // the base layer because the console/platform hosts are not tenant
    // domains and never appear in the registry. A registry outage
    // degrades to the allowlist alone (last-good snapshot while one
    // exists); custom-domain origins then fail closed until the
    // registry answers again. Never echo the request origin blindly.
    trustedOrigins: async (request) => {
      const origin = request?.headers.get('origin');
      if (!origin) return [];
      let host: string;
      try {
        host = new URL(origin).host;
      } catch {
        return [];
      }
      // Strip any port for comparison against bare-host entries, but also
      // accept exact host:port matches (local dev).
      const bareHost = host.split(':')[0];
      const allowed = config.trustedHosts.some(
        (h) => h === host || h === bareHost,
      );
      if (allowed) return [origin];
      if (registry && (await registry.isRegisteredHost(bareHost))) {
        return [origin];
      }
      return [];
    },
    advanced: {
      trustedProxyHeaders: true,
      // Client-IP resolution for BA's own rate limiting (Phase 1 §5
      // finding 3 — CLOSED by this block + the Caddy X-Forwarded-For
      // forwarding; without a resolvable IP BA falls back to one shared
      // per-path bucket). `ipAddressHeaders` restates BA's default
      // (["x-forwarded-for"]) explicitly so the contract is visible.
      // `trustedProxies` (AUTH_TRUSTED_PROXIES) lets BA walk a
      // multi-value forwarded chain past the upstream proxy's hops —
      // required when Cloudflare fronts Caddy (it appends its edge IP,
      // making the header multi-value); with no trusted proxies only a
      // single-value header is trusted, which is exactly what Caddy
      // sends as the direct edge. See src/tenant-registry.ts header +
      // README "Rate limiting" for the deployment rule.
      ipAddress: {
        ipAddressHeaders: ['x-forwarded-for'],
        ...(config.trustedProxies.length > 0
          ? { trustedProxies: config.trustedProxies }
          : {}),
      },
      // disableOriginCheck: FALSE, explicitly. BA 1.7.28 defaults
      // skipOriginCheck to TRUE whenever NODE_ENV=test
      // (dist/context/create-context.mjs:211, isTest() = NODE_ENV==="test"
      // || TEST env, @better-auth/core/dist/env/env-impl.mjs:37). Our
      // smoke/test servers run under NODE_ENV=test, which silently
      // disabled the whole origin/CSRF gate (verified 2026-11-26: evil
      // Origin + evil callbackURL both returned 200 until this flag was
      // set). Fail closed: the check is on in every environment.
      disableOriginCheck: false,
      useSecureCookies: true,
      defaultCookieAttributes: {
        sameSite: 'lax',
        httpOnly: true,
        secure: true,
      },
      // crossSubDomainCookies: OFF (default). One host-only cookie per
      // origin; separate logins per origin (D14=A).
      // cookiePrefix: default ("better-auth").
    },
    database,
    emailAndPassword: {
      enabled: true,
      // A password reset must kill every session (closes the §1.6 gap:
      // the custom OTP reset never revoked BA sessions).
      revokeSessionsOnPasswordReset: true,
      // Reset-link TTL: 15 minutes — preserves the current custom OTP
      // reset window (auth.service.ts forgot-password: expiresAt now+15m).
      // Q5 resolution: BA default is 3600s (dist/api/routes/password.mjs:73
      // `resetPasswordTokenExpiresIn || 3600`); set explicitly to 900.
      resetPasswordTokenExpiresIn: 900,
      // requireEmailVerification: FALSE — preserved behaviour. Today the
      // legacy login never checks emailVerified (auth.service.ts login has
      // no emailVerified gate; register sets emailVerified:false and the
      // user can sign in immediately). Do not newly block sign-in for
      // unverified users.
      requireEmailVerification: false,
      password: {
        // Dispatching verify (migration pattern, plan §3.7): stored hashes
        // starting with `$2` are bcrypt (console operators, bcrypt-12) and
        // verify with bcryptjs.compare; everything else verifies with BA's
        // default scrypt verify. `hash` is deliberately NOT overridden, so
        // new/changed passwords become scrypt and the fleet converges.
        verify: async ({ hash, password }) => {
          if (hash.startsWith('$2')) {
            return bcrypt.compare(password, hash);
          }
          return verifyPassword({ hash, password });
        },
      },
      sendResetPassword: async ({ user, url }) => {
        await mailer.sendResetPasswordEmail(user.email, url);
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await mailer.sendVerificationEmail(user.email, url);
      },
      // Verification-link TTL: 24 hours — preserves the current custom
      // EMAIL_VERIFICATION OTP window (auth.service.ts: 24h). BA default
      // is 3600s (dist/api/routes/email-verification.mjs:14); set explicitly.
      expiresIn: 60 * 60 * 24,
    },
    socialProviders: {
      // D9=B: BA built-in OAuth, configured from env. Empty id/secret =
      // disabled (same shape as the backend today). Constraint (Phase 0):
      // providers forbid wildcard redirect URIs, so social works only on
      // a fixed host set — per-tenant-subdomain callbacks are not
      // registerable; scope the later login UI accordingly.
      google: {
        clientId: config.social.google.clientId,
        clientSecret: config.social.google.clientSecret,
      },
      github: {
        clientId: config.social.github.clientId,
        clientSecret: config.social.github.clientSecret,
      },
      facebook: {
        clientId: config.social.facebook.clientId,
        clientSecret: config.social.facebook.clientSecret,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7d (D3=A)
      updateAge: 60 * 60 * 24, // 1d sliding refresh
      freshAge: 60 * 60 * 24, // 1d freshness gate for sensitive endpoints
      cookieCache: { enabled: true, maxAge: 300, strategy: 'compact' },
    },
    user: {
      additionalFields: {
        // D5=A: console operator role (SUPERADMIN/BILLING/SUPPORT/READONLY)
        // on the central user. input:false — never client-settable; the
        // databaseHooks below are the second layer (same pattern as the
        // backend's role stripping).
        platformRole: { type: 'string', required: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const { platformRole: _platformRole, ...rest } = user as Record<
              string,
              unknown
            >;
            return { data: rest };
          },
        },
        update: {
          before: async (user) => {
            const { platformRole: _platformRole, ...rest } = user as Record<
              string,
              unknown
            >;
            return { data: rest };
          },
        },
      },
      session: {
        create: {
          // Q11 — social sign-in TOTP gate (design §3). The twoFactor
          // plugin gates ONLY credential sign-ins (signInPaths), and the
          // OAuth callback never sets newSession and never returns
          // normally (it throws a redirect), so no hooks.after point
          // exists. The interception point that DOES run is
          // databaseHooks.session.create.before (db/with-hooks.mjs): a
          // throw aborts the insert, so no session row ever exists
          // between the challenge and the code.
          //
          // Acts ONLY when ctx.path starts with "/callback/" (the OAuth
          // callback route pattern, api/dispatch.mjs:225). Does not fire
          // for credential sign-in (the plugin's own after-hook owns
          // that path), for /two-factor/verify-totp's own session
          // creation (challenge completion), for admin impersonation,
          // or for session creation with no endpoint context.
          before: async (session, ctx) => {
            const path = ctx?.path ?? null;
            if (!ctx || !path) return; // no endpoint ctx: allow
            if (!path.startsWith('/callback/')) return;
            // internalAdapter.findUserById returns the core User type,
            // which omits plugin fields — twoFactorEnabled is a
            // twoFactor-plugin field, so read it via a narrow cast.
            const user = (await ctx.context.internalAdapter.findUserById(
              session.userId,
            )) as { id: string; twoFactorEnabled?: boolean } | null;
            if (!user?.twoFactorEnabled) return;
            // Trust-device (mandatory — §3.4): replicate the plugin's
            // readSignInTwoFactorState (plugins/two-factor/index.mjs:30-53)
            // with this session's user. A TOTP user on a trusted device
            // is not re-challenged — social login must not be harsher
            // than password login for the same user/device. Any failure
            // of the check itself fails CLOSED (challenge, don't allow).
            let trusted = false;
            try {
              const trustCookie = ctx.context.createAuthCookie(
                TRUST_DEVICE_COOKIE_NAME,
                { maxAge: TRUST_DEVICE_MAX_AGE },
              );
              const signed = await ctx.getSignedCookie(
                trustCookie.name,
                ctx.context.secret,
              );
              if (signed) {
                const [token, trustIdentifier] = signed.split('!');
                if (token && trustIdentifier) {
                  const expected = await createHMAC(
                    'SHA-256',
                    'base64urlnopad',
                  ).sign(
                    ctx.context.secret,
                    `${user.id}!${trustIdentifier}`,
                  );
                  if (token === expected) {
                    const record =
                      await ctx.context.internalAdapter.findVerificationValue(
                        trustIdentifier,
                      );
                    trusted =
                      !!record &&
                      record.value === user.id &&
                      new Date(record.expiresAt).getTime() > Date.now();
                  }
                }
              }
            } catch {
              trusted = false;
            }
            if (trusted) return;
            // Mint the challenge EXACTLY like the plugin's credential
            // after-hook (plugins/two-factor/index.mjs:330-375): a 2fa-*
            // verification value holding the user id + an attempts
            // counter, and the signed two_factor cookie (600 s).
            const maxAge = 600; // == twoFactorCookieMaxAge default
            const identifier = `2fa-${randomBytes(10).toString('hex')}`;
            const expiresAt = new Date(Date.now() + maxAge * 1000);
            await ctx.context.internalAdapter.createVerificationValue({
              value: user.id,
              identifier,
              expiresAt,
            });
            await ctx.context.internalAdapter.createVerificationValue({
              value: '0',
              identifier: `2fa-attempts-${identifier}`,
              expiresAt,
            });
            const cookie = ctx.context.createAuthCookie('two_factor', {
              maxAge,
            });
            await ctx.setSignedCookie(
              cookie.name,
              identifier,
              ctx.context.secret,
              cookie.attributes,
            );
            throw APIError.from('FORBIDDEN', {
              code: 'TWO_FACTOR_REQUIRED',
              message: 'Two-factor authentication is required',
            });
          },
        },
      },
    },
    // Rate limiting — BA 1.7.28 built-ins, configured explicitly.
    // Source: dist/context/create-context.mjs:170-175 (enabled defaults to
    // isProduction, window 10s, max 100) and
    // dist/api/rate-limiter/index.mjs:305-321 (built-in special rules:
    // sign-in/sign-up/change-password/change-email 3/10s;
    // request-password-reset/send-verification-email 3/60s).
    // Values chosen (each at least as strict as the strictest current path):
    // - general: 100/min per IP+path (BA default window is 10s; 60s stated
    //   explicitly so the window is visible in config, not a default).
    // - /sign-in/email + /sign-up/email: 10/min per IP — exact tenant
    //   hijack-limiter parity (10 attempts/IP/endpoint/min). The 15-min
    //   block the rolling window cannot express is added by the server
    //   wrapper (src/ip-limits.ts) + the account lockout (src/lockout.ts).
    // - /request-password-reset + /send-verification-email: 3/60s — BA
    //   built-in default, restated explicitly.
    // - /two-factor/*: NOT overridden — the plugin's own 3/10s rule
    //   (dist/plugins/two-factor/index.mjs:389-395) stays, plus the
    //   server-side 10/10-min per-IP challenge cap (platform parity) and
    //   the plugin account lockout below.
    // Rate-limit storage is BA's default (memory for a single instance;
    // see README "Scaling notes").
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        // Q11 finding (measured 2026-11-26): BA's DEFAULT special rule
        // (dist/api/rate-limiter/index.mjs:305-312) caps EVERY /sign-in/*
        // path without a custom rule at 3 requests per 10 s — and the
        // bucket is shared (no client IP is resolvable in this setup, so
        // getIP falls back to one bucket per path). Social sign-in needs
        // the same 10/min budget as credential sign-in, or the second
        // social login inside 10 s 429s. Parity rule, not a relaxation.
        '/sign-in/social': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 10 },
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 3 },
        '/impersonation/consume': { window: 60, max: 20 },
      },
    },
    plugins: [
      organization({
        // Function form (Q9, design §2): return true when the limit is
        // reached — the docs wording is correct, not inverted (SOURCE:
        // dist/plugins/organization/routes/crud-org.mjs:61 — the
        // function form blocks when the awaited return is truthy; the
        // scaffold's "reads inverted — untested" comment was wrong).
        // Shared with the provisioning path via src/org-limits.ts.
        organizationLimit: makeOrganizationLimitChecker(prisma, {
          platformApiUrl: config.platformApiUrl,
          internalSecret: config.internalServiceSecret,
          fallback: config.organizationLimit,
        }),
        // Staff only are members (D4=A); 100 is plenty. Default, explicit.
        membershipLimit: config.membershipLimit,
        allowUserToCreateOrganization: false,
        creatorRole: 'owner',
        // BA org invitation default is 48h (vs platform operator invites
        // 72h) — stated explicitly; the copy difference is a Phase 4
        // comms item (Q12).
        invitationExpiresIn: 60 * 60 * 48,
        dynamicAccessControl: { enabled: true },
        // Teams OFF — no team concept in EcoMate today.
        ac: statement,
        roles: {
          owner: ownerAc,
          admin: adminAc,
          cashier: staffRole,
          packing_assistant: staffRole,
          employee: staffRole,
        },
      }),
      twoFactor({
        // TOTP 6 digits / 30 s — matches the current hand-rolled console
        // TOTP exactly (HMAC-SHA1, 6, 30s, ±1 window).
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: {
          amount: 10,
          length: 10,
          // Q6 resolution: BA 1.7.28's DEFAULT is already "encrypted"
          // (dist/plugins/two-factor/index.mjs:60
          // `storeBackupCodes: "encrypted"` merged under user options).
          // Set explicitly so a future default change cannot silently
          // switch backup codes to plaintext storage.
          storeBackupCodes: 'encrypted',
        },
        // TOTP account lockout: 10 consecutive failed verifications lock
        // the account for 15 min (900 s). Source:
        // dist/plugins/two-factor/verify-two-factor.mjs:120-128
        // (defaults: enabled, maxFailedAttempts 10, durationSeconds 900).
        // Matches the platform Redis mfa:verify limiter (10/10 min per
        // user) and the 15-min lockout shape; set explicitly.
        accountLockout: {
          enabled: true,
          maxFailedAttempts: 10,
          durationSeconds: 900,
        },
      }),
      // Admin plugin (Q7, design §1): narrow custom roles — "operator"
      // may ONLY impersonate; "user" holds nothing; there is NO "admin"
      // role in the map (fail-closed). adminUserIds stays UNSET forever.
      // The raw /admin/* HTTP endpoints are edge-blocked in src/server.ts
      // except POST /admin/stop-impersonating; the plugin's power is
      // reachable only in-process (issue handler) and via stop.
      // Who holds role="operator": console operators with platformRole ∈
      // {SUPERADMIN, SUPPORT} — set at Phase 2 migration, maintained by
      // POST /internal/users/role-sync. Break-glass is a direct DB role
      // update per runbook, never adminUserIds.
      admin({
        roles: { operator: operatorRole, user: plainUserRole },
        adminRoles: ['operator'],
        defaultRole: 'user',
        // adminUserIds: NEVER set (see above).
        impersonationSessionDuration: config.impersonationTtlSeconds,
      }),
      // D8 handoff — consume endpoint (design §4.4). Only wired when a
      // Prisma client exists (production/test); the schema-generation
      // context has none and never serves a request. The registry is
      // threaded through for the custom-domain host check (null =
      // Phase 1 host rules).
      ...(prisma
        ? [createImpersonationHandoffPlugin({ prisma, config, registry })]
        : []),
      // TEST-ONLY fake generic-OAuth IdP for the Q11 tests (config.fakeIdp
      // is populated only under NODE_ENV=test with AUTH_FAKE_IDP_* set).
      // Never enabled in production.
      ...(config.fakeIdp
        ? [
            genericOAuth({
              config: [
                {
                  providerId: 'fakeidp',
                  clientId: 'fake-client',
                  clientSecret: 'fake-secret',
                  authorizationUrl: config.fakeIdp.authorizationUrl,
                  tokenUrl: config.fakeIdp.tokenUrl,
                  scopes: ['openid', 'email', 'profile'],
                  getUserInfo: async () => {
                    const email = getFakeIdpEmail();
                    return {
                      id: `fakeidp-${email}`,
                      email,
                      name: 'Fake User',
                      emailVerified: true,
                    };
                  },
                },
              ],
            }),
          ]
        : []),
      // NOT enabled in Phase 1 (deliberate seams — see README):
      // - bearer / JWT plugins: Phase 0 verdict — HTTP getSession is the
      //   design; bearer is transport-only, JWT+JWKS local verify is not
      //   adopted.
    ],
  };
}

