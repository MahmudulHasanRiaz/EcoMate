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

export function createAuth(config: AuthServiceConfig) {
  const prisma = getPrisma(config);
  const mailer = createMailer(config);
  const auth = betterAuth(
    buildAuthOptions({
      config,
      database: prismaAdapter(prisma, { provider: 'postgresql' }),
      mailer,
      prisma,
    }),
  );
  return { auth, prisma, mailer, config };
}
