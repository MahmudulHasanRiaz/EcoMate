# IDX Template: Prisma Postgres 

This template helps you get started with [Prisma Postgres](https://www.prisma.io/blog/announcing-prisma-postgres-early-access) on [IDX](https://idx.google.com/).

## Getting started

Follow these instructions once this project was opened in IDX.

### 1. Create Prisma Postgres database & set environment variables

First, you need to create your Prisma Postgres instance:

1. Log in to [Prisma Data Platform](https://console.prisma.io/).
1. In a [workspace](https://www.prisma.io/docs/platform/about#workspace) of your choice, click the **New project** button.
1. Type a name for your project in the **Name** field, e.g. **hello-ppg**.
1. In the **Prisma Postgres** section, click the **Get started** button.
1. In the **Region** dropdown, select the region that's closest to your current location, e.g. **US East (N. Virginia)**.
1. Click the **Create project** button.

Once the database is ready, copy the `DATABASE_URL` environment variable.

Then, create a `.env` file in the root of your project and add the connection string to it:
```bash
DATABASE_URL="YOUR_CONNECTION_STRING_HERE"
```
**Note**: The Prisma CLI automatically loads the `.env` file, so you don't need to do any extra setup.

### 2. Run a schema migration

Next, you need to create the tables in your database. You can do this by creating and executing a schema migration with the following command of the Prisma CLI:

```
npx prisma migrate dev --name init
```

This will map the models that are defined in your [Prisma schema](./prisma/schema.prisma) to your database. You can also review the SQL migration that was executed and created the tables in the newly created `prisma/migrations` directory.

### 3. Seed the database (Optional)

You can run the `prisma/seed.ts` script to populate your database with some initial data.

```
npx prisma db seed
```

### 4. Explore your data with Prisma Studio

You can use Prisma Studio to explore the records that have been created in the database:

```
npx prisma studio
```

## Next steps

- Check out the [Prisma docs](https://www.prisma.io/docs)
- Share your feedback on the [Prisma Discord](https://pris.ly/discord/)
- Create issues and ask questions on [GitHub](https://github.com/prisma/prisma/)
