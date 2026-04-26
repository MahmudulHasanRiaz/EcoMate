import prisma from '@/lib/prisma';
import { AccountType } from '@prisma/client';

export type CashDrawerBalanceInfo = {
  id: string;
  name: string;
  accountId: string;
  isActive: boolean;
  isDefault: boolean;
  businessId: string | null;
  balance: number;
};

/**
 * Ensures at least one default Cash Drawer exists if none is configured.
 * Backward compatibility: Finds an existing Account named "Cash" or creates one,
 * then points a CashDrawer to it.
 */
export async function ensureDefaultCashDrawer(businessId?: string) {
  const existingDrawers = await prisma.cashDrawer.findMany({
    where: businessId ? { businessId } : {},
    take: 1,
  });

  if (existingDrawers.length > 0) return existingDrawers[0];

  // Logic to find or create the backward-compatible "Cash" account
  let cashAccount = await prisma.account.findFirst({
    where: { name: 'Cash', type: AccountType.Asset },
  });

  if (!cashAccount) {
    cashAccount = await prisma.account.create({
      data: { name: 'Cash', type: AccountType.Asset },
    });
  }

  // Check if drawer exists for this account
  let drawer = await prisma.cashDrawer.findUnique({
    where: { accountId: cashAccount.id },
  });

  if (!drawer) {
    drawer = await prisma.cashDrawer.create({
      data: {
        name: 'Main Cash Drawer',
        accountId: cashAccount.id,
        isDefault: true,
        businessId,
      },
    });
  } else if (!drawer.isDefault) {
    drawer = await prisma.cashDrawer.update({
      where: { id: drawer.id },
      data: { isDefault: true, businessId },
    });
  }

  return drawer;
}

/**
 * Gets all Cash Drawers with dynamic balances computed from the Ledger.
 */
export async function getCashDrawersWithBalances(businessId?: string): Promise<CashDrawerBalanceInfo[]> {
  await ensureDefaultCashDrawer(businessId);

  const drawers = await prisma.cashDrawer.findMany({
    where: businessId ? { businessId } : {},
    orderBy: { createdAt: 'asc' },
  });

  if (drawers.length === 0) return [];

  const accountIds = drawers.map(d => d.accountId);

  // Calculate balances from ledger. Cash (Asset) -> Debit increases, Credit decreases.
  const ledgerGroups = await prisma.ledgerEntry.groupBy({
    by: ['accountId'],
    where: { accountId: { in: accountIds } },
    _sum: { debit: true, credit: true },
  });

  const balancesMapMap: Record<string, number> = {};
  for (const group of ledgerGroups) {
    const sumDebit = group._sum.debit || 0;
    const sumCredit = group._sum.credit || 0;
    balancesMapMap[group.accountId] = sumDebit - sumCredit;
  }

  return drawers.map(drawer => ({
    id: drawer.id,
    name: drawer.name,
    accountId: drawer.accountId,
    isActive: drawer.isActive,
    isDefault: drawer.isDefault,
    businessId: drawer.businessId,
    balance: balancesMapMap[drawer.accountId] || 0,
  }));
}

/**
 * Helper strictly enforcing that an account points to a CashDrawer.
 */
export async function assertCashDrawerAccount(accountId: string | undefined | null) {
  if (!accountId) return;

  const drawer = await prisma.cashDrawer.findUnique({
    where: { accountId },
  });

  if (!drawer) {
    throw new Error('CASH_DRAWER_REQUIRED');
  }

  if (!drawer.isActive) {
    throw new Error('CASH_DRAWER_INACTIVE');
  }
}

/**
 * Creates a new Cash Drawer & corresponding Asset Account.
 */
export async function createCashDrawer(name: string, businessId?: string, actorId?: string, isDefault = false) {
  const account = await prisma.account.create({
    data: { name: `Cash Drawer - ${name}`, type: AccountType.Asset },
  });

  if (isDefault) {
    // Unset other defaults if this is default
    await prisma.cashDrawer.updateMany({
      where: businessId ? { businessId } : {},
      data: { isDefault: false },
    });
  }

  return await prisma.cashDrawer.create({
    data: {
      name,
      accountId: account.id,
      isDefault,
      businessId,
      createdById: actorId,
    },
  });
}

/**
 * Updates a Cash Drawer's name and default status.
 */
export async function updateCashDrawer(id: string, name: string, isDefault: boolean, businessId?: string) {
  if (isDefault) {
    await prisma.cashDrawer.updateMany({
      where: Object.assign({ id: { not: id } }, businessId ? { businessId } : {}),
      data: { isDefault: false },
    });
  }

  const drawer = await prisma.cashDrawer.update({
    where: { id },
    data: { name, isDefault },
  });

  await prisma.account.update({
    where: { id: drawer.accountId },
    data: { name: `Cash Drawer - ${name}` },
  });

  return drawer;
}

/**
 * Deactivates a Cash Drawer if zero balance and no transactions? 
 * Actually, API layer checks balance/ledger. We just update isActive.
 */
export async function deactivateCashDrawer(id: string) {
  return await prisma.cashDrawer.update({
    where: { id },
    data: { isActive: false },
  });
}

/**
 * Transfers cash between two drawers.
 */
export async function transferCashDrawer(
  fromDrawerId: string, 
  toDrawerId: string, 
  amount: number, 
  notes?: string, 
  businessId?: string, 
  actorId?: string
) {
  if (amount <= 0) throw new Error('Invalid transfer amount');

  const fromDrawer = await prisma.cashDrawer.findUnique({ where: { id: fromDrawerId } });
  const toDrawer = await prisma.cashDrawer.findUnique({ where: { id: toDrawerId } });

  if (!fromDrawer || !toDrawer) throw new Error('Cash drawer not found');
  if (!fromDrawer.isActive) throw new Error('Source drawer is inactive');
  if (!toDrawer.isActive) throw new Error('Destination drawer is inactive');

  // Cross-business safety: reject if drawers belong to different businesses
  if (fromDrawer.businessId && toDrawer.businessId && fromDrawer.businessId !== toDrawer.businessId) {
    throw new Error('Cannot transfer between drawers of different businesses');
  }

  // If caller specified a businessId, verify both drawers belong to it
  if (businessId) {
    if (fromDrawer.businessId && fromDrawer.businessId !== businessId) {
      throw new Error('Source drawer does not belong to the specified business');
    }
    if (toDrawer.businessId && toDrawer.businessId !== businessId) {
      throw new Error('Destination drawer does not belong to the specified business');
    }
  }

  // Verify sufficient balance in source drawer
  const ledgerAgg = await prisma.ledgerEntry.aggregate({
    where: { accountId: fromDrawer.accountId },
    _sum: { debit: true, credit: true },
  });
  const fromBalance = (ledgerAgg._sum.debit || 0) - (ledgerAgg._sum.credit || 0);
  if (fromBalance < amount) {
    throw new Error(`Insufficient balance in "${fromDrawer.name}". Available: ${fromBalance.toFixed(2)}, Requested: ${amount.toFixed(2)}`);
  }

  const postingGroup = `CDT-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  await prisma.$transaction([
    prisma.ledgerEntry.create({
      data: {
        accountId: fromDrawer.accountId,
        debit: 0,
        credit: amount,
        description: `Transfer to ${toDrawer.name}${notes ? ` - ${notes}` : ''}`,
        sourceTransactionId: postingGroup,
        postingGroup,
        date: new Date(),
        businessId,
      },
    }),
    prisma.ledgerEntry.create({
      data: {
        accountId: toDrawer.accountId,
        debit: amount,
        credit: 0,
        description: `Transfer from ${fromDrawer.name}${notes ? ` - ${notes}` : ''}`,
        sourceTransactionId: postingGroup,
        postingGroup,
        date: new Date(),
        businessId,
      },
    }),
    prisma.cashDrawerTransfer.create({
      data: {
        fromDrawerId,
        toDrawerId,
        amount,
        notes,
        postingGroup,
        businessId,
        createdById: actorId,
      },
    }),
  ]);

  return { success: true, postingGroup };
}
