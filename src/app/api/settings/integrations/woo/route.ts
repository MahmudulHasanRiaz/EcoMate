import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const revalidate = 0;

export async function GET() {
  const stores = await prisma.wooCommerceIntegration.findMany({
    orderBy: { createdAt: 'desc' },
    include: { business: true },
  });

  return NextResponse.json(
    stores.map((s) => ({
      id: s.id,
      businessId: s.businessId,
      businessName: s.business?.name || '',
      businessPhone: s.business?.phone || '',
      businessAddress: s.business?.address || '',
      storeName: s.storeName,
      storeUrl: s.storeUrl,
      consumerKey: s.consumerKey,
      consumerSecret: s.consumerSecret,
      webhookUrl: (s as any).webhookUrl || '',
      webhookSecret: (s as any).webhookSecret || '',
      apiKey: (s as any).apiKey || '',
      incompleteEnabled: (s as any).incompleteEnabled ?? false,
      autoSyncEnabled: (s as any).autoSyncEnabled ?? true,
      restrictionEnabled: (s as any).restrictionEnabled ?? false,
      restrictionScope: (s as any).restrictionScope || 'site',
      restrictionDurationType: (s as any).restrictionDurationType || 'days',
      restrictionDurationValue: (s as any).restrictionDurationValue ?? 1,
      restrictionMessage: (s as any).restrictionMessage || '',
      restrictionSupportPhone: (s as any).restrictionSupportPhone || '',
      dedupeMinutes: (s as any).dedupeMinutes ?? 10,
      debounceMs: (s as any).debounceMs ?? 1200,
      retrySeconds: (s as any).retrySeconds ?? 15,
      supportPhone: (s as any).supportPhone || '',
      status: s.status,
      createdAt: s.createdAt,
    }))
  );
}
