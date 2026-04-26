'use server';

import { createWooIntegrationCore, updateWooIntegrationCore, deleteWooIntegrationCore } from '@server/modules/integrations';

export async function createWooIntegration(input: Parameters<typeof createWooIntegrationCore>[0]) {
  return createWooIntegrationCore(input);
}

export async function updateWooIntegration(input: Parameters<typeof updateWooIntegrationCore>[0]) {
  return updateWooIntegrationCore(input);
}

export async function deleteWooIntegration(id: string) {
  return deleteWooIntegrationCore(id);
}
