import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { ensureWooWebhook } from '../src/server/modules/woo-sync';

function parseArgs() {
  const raw = process.argv.slice(2);
  const forceRecreate = raw.includes('--force');
  const rotateSecret = raw.includes('--rotate-secret');
  const idArg = raw.find((arg) => !arg.startsWith('--'));
  return { forceRecreate, rotateSecret, idArg };
}

async function main() {
  const { forceRecreate, rotateSecret, idArg } = parseArgs();

  const integration = idArg
    ? await prisma.wooCommerceIntegration.findUnique({
        where: { id: idArg },
      })
    : await prisma.wooCommerceIntegration.findFirst({
        where: { status: 'Active' },
        orderBy: { updatedAt: 'desc' },
      });

  if (!integration) {
    throw new Error(`Woo integration not found${idArg ? ` for id ${idArg}` : ''}`);
  }

  console.log('[ENSURE_WOO_WEBHOOK] integration=', integration.id);
  console.log('[ENSURE_WOO_WEBHOOK] options=', {
    forceRecreate,
    rotateSecret,
  });

  await ensureWooWebhook(integration, { forceRecreate, rotateSecret });

  console.log('[ENSURE_WOO_WEBHOOK] done');
}

main()
  .catch((err) => {
    console.error('[ENSURE_WOO_WEBHOOK_ERROR]', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
