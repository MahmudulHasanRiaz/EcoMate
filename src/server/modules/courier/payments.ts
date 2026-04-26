import { Prisma } from '@prisma/client';
import { ACCOUNT_LABELS, getAccountIdByName, resolveLedgerEntryNumber } from '@/server/modules/accounting';

export type CreateCourierPaymentInput = {
  courierService: string;
  businessId: string;
  amount: number;
  paymentDate: Date;
  referenceNo?: string;
  note?: string;
  direction: 'Paid' | 'Received';
  receivedAccountId?: string | null;
  createdBy: string;
};

export async function createCourierPaymentWithLedger(
  tx: Prisma.TransactionClient,
  input: CreateCourierPaymentInput
) {
  if (input.receivedAccountId) {
    const account = await tx.account.findUnique({ where: { id: input.receivedAccountId }, select: { name: true } });
    if (account && account.name.toLowerCase().includes('cash')) {
      const { assertCashDrawerAccount } = await import('@/server/modules/cash-drawers');
      try {
        await assertCashDrawerAccount(input.receivedAccountId);
      } catch (err: any) {
        throw new Error(err.message === 'CASH_DRAWER_INACTIVE' ? 'Selected Cash Drawer is inactive.' : 'Cash payments must specify a valid Cash Drawer.');
      }
    }
  }

  const payment = await tx.courierPayment.create({
    data: {
      courierService: input.courierService,
      businessId: input.businessId,
      direction: input.direction,
      amount: input.amount,
      paymentDate: input.paymentDate,
      referenceNo: input.referenceNo,
      note: input.note,
      createdBy: input.createdBy,
      receivedAccountId: input.receivedAccountId,
    },
    include: { Business: { select: { name: true } } },
  });

  const cashAccountId = input.receivedAccountId || (await getAccountIdByName(ACCOUNT_LABELS.cash));
  
  if (cashAccountId) {
    const account = await tx.account.findUnique({ where: { id: cashAccountId }, select: { name: true } });
    const accountName = account?.name || 'Cash';
    
    const postingGroup = `courierPayment:${payment.id}`;
    const entryNumber = await resolveLedgerEntryNumber(tx as any, { 
      postingGroup,
      date: payment.paymentDate,
    });
    
    await tx.ledgerEntry.deleteMany({
      where: { postingGroup },
    });
    
    if (input.direction === 'Paid') {
      const courierPayableId = await getAccountIdByName(ACCOUNT_LABELS.courierPayable);
      if (courierPayableId) {
        await tx.ledgerEntry.createMany({
          data: [
            {
              date: payment.paymentDate,
              description: `Courier payable settlement (${payment.courierService}) -> ${accountName}`,
              sourceTransactionId: payment.id,
              accountId: courierPayableId,
              debit: payment.amount,
              credit: 0,
              businessId: payment.businessId,
              postingGroup,
              entryNumber,
            },
            {
              date: payment.paymentDate,
              description: `Courier payable payment (${payment.courierService}) -> ${accountName}`,
              sourceTransactionId: payment.id,
              accountId: cashAccountId,
              debit: 0,
              credit: payment.amount,
              businessId: payment.businessId,
              postingGroup,
              entryNumber,
            },
          ],
          skipDuplicates: true,
        });
      }
    } else {
      const courierReceivableId = await getAccountIdByName(ACCOUNT_LABELS.courierReceivable);
      if (courierReceivableId) {
        await tx.ledgerEntry.createMany({
          data: [
            {
              date: payment.paymentDate,
              description: `Courier payment received (${payment.courierService}) -> ${accountName}`,
              sourceTransactionId: payment.id,
              accountId: cashAccountId,
              debit: payment.amount,
              credit: 0,
              businessId: payment.businessId,
              postingGroup,
              entryNumber,
            },
            {
              date: payment.paymentDate,
              description: `Courier receivable settled (${payment.courierService}) -> ${accountName}`,
              sourceTransactionId: payment.id,
              accountId: courierReceivableId,
              debit: 0,
              credit: payment.amount,
              businessId: payment.businessId,
              postingGroup,
              entryNumber,
            },
          ],
          skipDuplicates: true,
        });
      }
    }
  }

  return payment;
}
