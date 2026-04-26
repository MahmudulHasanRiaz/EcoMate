// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client';

// This setup prevents creating too many PrismaClient instances in a serverless environment like Next.js.
// It creates a single, cached instance.

const prismaClientSingleton = () => {
  return new PrismaClient();
};

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>;
}

export const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaGlobal = prisma;
}

export default prisma;
