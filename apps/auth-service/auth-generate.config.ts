// Schema-generation helper — loads the service's real buildAuthOptions
// with a memory adapter so `npx auth generate` can emit the Prisma schema
// without a generated Prisma client existing yet. NOT imported by the
// service (tsconfig includes src/ only). Keep for regeneration; see the
// schema header for the exact command.
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { buildAuthOptions } from './src/auth-options.js';
import { loadConfig } from './src/config.js';

const config = loadConfig();

export const auth = betterAuth(
  buildAuthOptions({
    config,
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      organization: [],
      member: [],
      invitation: [],
      organizationRole: [],
      twoFactor: [],
      jwks: [],
      passkey: [],
      deviceCode: [],
    }),
    mailer: {
      sendVerificationEmail: async () => {},
      sendResetPasswordEmail: async () => {},
    },
  }),
);
