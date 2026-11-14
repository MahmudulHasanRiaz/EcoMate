import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['PLATFORM_DATABASE_URL'],
    shadowDatabaseUrl: process.env['PLATFORM_DATABASE_URL']
      ? `${process.env['PLATFORM_DATABASE_URL']}_shadow`
      : undefined,
  },
});
