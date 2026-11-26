// Prisma 7 config for the auth service (mirrors apps/backend and
// apps/platform-api): the datasource URL comes from AUTH_DB_URL; migrate
// commands read it from here, the runtime client connects via the pg
// adapter in src/prisma.ts.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['AUTH_DB_URL'],
  },
});
