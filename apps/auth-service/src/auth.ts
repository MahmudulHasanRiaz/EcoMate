// Central Better Auth instance (D1=A, D2=A).
//
// One instance, one database (`ecomate_auth`), serving every origin:
// tenant subdomains (*.faah.net / *.ecomate.bd), the console
// (em.commercians.com), and verified custom domains. Sessions stay
// per-origin (D14=A): cookies are host-only, no Domain attribute, no
// cross-subdomain cookies — a user signs in separately on each host.
//
// This module is split as buildAuthOptions(deps) so the schema generator
// (`npx auth generate`) can reuse the exact options with a scratch adapter
// without importing the production Prisma client (see prisma/README note in
// the service README).
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { buildAuthOptions } from './auth-options.js';
import type { AuthServiceConfig } from './config.js';
import { getPrisma } from './prisma.js';
import { createMailer } from './mailer.js';
import { createTenantRegistry } from './tenant-registry.js';

export function createAuth(config: AuthServiceConfig) {
  const prisma = getPrisma(config);
  const mailer = createMailer(config);
  // Live platform tenant registry (Phase 3): null when the platform-api
  // is not reachable from this service — trustedOrigins and the consume
  // host check then keep their Phase 1 behaviour. The SAME allowedHosts
  // array reference is handed to both the registry and Better Auth
  // (buildAuthOptions passes config.allowedHosts through verbatim), so
  // the registry's in-place sync is visible to BA's per-request
  // baseURL resolution — see src/tenant-registry.ts.
  const registry = createTenantRegistry({
    platformApiUrl: config.platformApiUrl,
    internalSecret: config.internalServiceSecret,
    allowedHosts: config.allowedHosts,
  });
  const auth = betterAuth(
    buildAuthOptions({
      config,
      database: prismaAdapter(prisma, { provider: 'postgresql' }),
      mailer,
      prisma,
      registry,
    }),
  );
  return { auth, prisma, mailer, config, registry };
}
