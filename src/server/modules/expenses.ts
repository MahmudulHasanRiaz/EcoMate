import prisma from '@/lib/prisma';
import { Prisma, OrderPlatform, CheckStatus, ExpenseApprovalStatus, CheckPassingSource } from '@prisma/client';
import { revalidateTags } from '../utils/revalidate';
import { ACCOUNT_LABELS, resolveLedgerEntryNumber } from './accounting';
import { buildCheckPassingItemFromExpense, upsertCheckPassingItem, deleteCheckPassingItem } from './check-passing-items';

type ExpenseDTO = {
  id: string;
  date: string;
  category: string;
  categoryId: string;
  amount: number;
  notes?: string;
  notesDisplay?: string;
  staffName?: string;
  staffCode?: string;
  staffId?: string;
  isAdExpense: boolean;
  isPaid?: boolean;
  paidFromAccountId?: string | null;
  payableAccountId?: string | null;
  check?: number;
  checkNo?: string | null;
  checkDate?: string | null;
  checkStatus?: CheckStatus | null;
  paidAt?: string | null;
  businessId?: string;
  business?: string;
  platform?: OrderPlatform;
  approvalStatus: ExpenseApprovalStatus;
  submittedById?: string | null;
  submittedByName?: string | null;
  submittedAt?: string | null;
  approvedById?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  rejectedById?: string | null;
  rejectedByName?: string | null;
  rejectedAt?: string | null;
  rejectionNote?: string | null;
  paidById?: string | null;
  paidByName?: string | null;
  branchId?: string | null;
  branchName?: string | null;
};

export type ExpenseInput = {
  date: string;
  categoryId: string;
  amount: number;
  notes?: string | null;
  businessId?: string | null;
  isAdExpense?: boolean;
  platform?: OrderPlatform | null;
  isPaid?: boolean;
  paidFromAccountId?: string | null;
  payableAccountId?: string | null;
  check?: number | null;
  checkNo?: string | null;
  checkDate?: Date | string | null;
  checkStatus?: CheckStatus | null;
  paidAt?: Date | string | null;

  staffPaymentId?: string | null;
  approvalStatus?: ExpenseApprovalStatus;
  rejectionNote?: string | null;
  submittedById?: string | null;
  submittedByName?: string | null;
  approvedById?: string | null;
  approvedByName?: string | null;
  rejectedById?: string | null;
  rejectedByName?: string | null;
  paidById?: string | null;
  paidByName?: string | null;
  branchId?: string | null;
};

function mapDbExpenseToDto(expense: any): ExpenseDTO {
  const staff = expense.StaffPayment?.staff;
  const staffName =
    staff && typeof staff.name === 'string' && staff.name.trim()
      ? staff.name.trim()
      : undefined;
  const staffCode =
    staff && typeof staff.staffCode === 'string' && staff.staffCode.trim()
      ? staff.staffCode.trim()
      : undefined;
  const staffLabel = staffName
    ? staffCode
      ? `${staffName} (${staffCode})`
      : staffName
    : undefined;
  const staffNotes =
    expense.StaffPayment?.notes && typeof expense.StaffPayment.notes === 'string'
      ? expense.StaffPayment.notes.trim()
      : '';
  const notesDisplay = staffLabel
    ? `Staff Payment: ${staffLabel}${staffNotes ? ` - ${staffNotes}` : ''}`
    : undefined;

  return {
    id: expense.id,
    date: expense.date instanceof Date ? expense.date.toISOString() : String(expense.date),
    category: expense.ExpenseCategory?.name ?? 'Unknown',
    categoryId: expense.categoryId,
    amount: Number(expense.amount ?? 0),
    notes: expense.notes ?? undefined,
    notesDisplay,
    staffName,
    staffCode,
    staffId: expense.StaffPayment?.staffId ?? undefined,
    isAdExpense: Boolean(expense.isAdExpense),
    isPaid: Boolean(expense.isPaid),
    paidFromAccountId: expense.paidFromAccountId ?? null,
    payableAccountId: expense.payableAccountId ?? null,
    check: Number(expense.check ?? 0),
    checkNo: expense.checkNo ?? null,
    checkDate: expense.checkDate ? expense.checkDate.toISOString() : null,
    checkStatus: expense.checkStatus ?? null,
    paidAt: expense.paidAt ? expense.paidAt.toISOString() : null,
    businessId: expense.businessId ?? undefined,
    business: expense.Business?.name ?? undefined,
    platform: expense.platform ?? undefined,
    approvalStatus: expense.approvalStatus,
    submittedById: expense.submittedById,
    submittedByName: expense.submittedByName,
    submittedAt: expense.submittedAt ? expense.submittedAt.toISOString() : null,
    approvedById: expense.approvedById,
    approvedByName: expense.approvedByName,
    approvedAt: expense.approvedAt ? expense.approvedAt.toISOString() : null,
    rejectedById: expense.rejectedById,
    rejectedByName: expense.rejectedByName,
    rejectedAt: expense.rejectedAt ? expense.rejectedAt.toISOString() : null,
    rejectionNote: expense.rejectionNote,
    paidById: expense.paidById,
    paidByName: expense.paidByName,
    branchId: expense.branchId ?? null,
    branchName: expense.Branch?.name ?? null,
  };
}

function normalizeDate(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid date');
  return parsed;
}

async function buildAccountIndex(tx: Prisma.TransactionClient) {
  const accounts = await tx.account.findMany({ select: { id: true, name: true } });
  const index = new Map<string, string>();
  accounts.forEach((acc) => index.set(acc.name.toLowerCase(), acc.id));
  return index;
}

function resolveAccount(index: Map<string, string>, label: string) {
  return index.get(label.toLowerCase());
}

function isSalaryCategory(category?: { name?: string | null }) {
  const name = String(category?.name || '').toLowerCase();
  return name.includes('salary') || name.includes('commission');
}

function resolveExpenseAccountId(
  index: Map<string, string>,
  expense: { isAdExpense?: boolean },
  category?: { name?: string | null; expenseAccountId?: string | null }
) {
  if (category?.expenseAccountId) return category.expenseAccountId;
  if (isSalaryCategory(category)) {
    return resolveAccount(index, ACCOUNT_LABELS.salary);
  }
  return resolveAccount(
    index,
    expense.isAdExpense ? ACCOUNT_LABELS.marketing : ACCOUNT_LABELS.operating
  );
}

async function postExpenseLedger(
  tx: Prisma.TransactionClient,
  expense: any,
  category: any
) {
  const amount = Number(expense.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return;

  const primaryPostingGroup = `expense:${expense.id}`;
  const settlementPostingGroup = `expenseSettlement:${expense.id}`;

  if (expense.approvalStatus !== 'Approved') {
    await tx.ledgerEntry.deleteMany({
      where: { postingGroup: { in: [primaryPostingGroup, settlementPostingGroup] } },
    });
    return;
  }

  const staff = expense.StaffPayment?.staff;
  const staffName =
    staff && typeof staff.name === 'string' && staff.name.trim()
      ? staff.name.trim()
      : undefined;
  const staffCode =
    staff && typeof staff.staffCode === 'string' && staff.staffCode.trim()
      ? staff.staffCode.trim()
      : undefined;
  const staffLabel = staffName
    ? staffCode
      ? `${staffName} (${staffCode})`
      : staffName
    : undefined;
  const baseLabel = staffLabel ? `Staff Payment: ${staffLabel}` : (category?.name || 'General');

  const index = await buildAccountIndex(tx);
  const expenseAccountId = resolveExpenseAccountId(index, expense, category);
  const payableAccountId =
    expense.payableAccountId ||
    resolveAccount(index, 'Accounts Payable');
  const cashAccountId =
    expense.paidFromAccountId ||
    resolveAccount(index, ACCOUNT_LABELS.cash);

  if (!expenseAccountId) return;
  if (!payableAccountId) return;

  const entryNumber = await resolveLedgerEntryNumber(tx, {
    postingGroup: primaryPostingGroup,
    date: expense.date,
  });

  await tx.ledgerEntry.deleteMany({
    where: { postingGroup: primaryPostingGroup },
  });

  await tx.ledgerEntry.createMany({
    data: [
      {
        date: expense.date,
        description: `Expense: ${baseLabel}`,
        sourceTransactionId: expense.id,
        accountId: expenseAccountId,
        debit: amount,
        credit: 0,
        businessId: expense.businessId ?? null,
        postingGroup: primaryPostingGroup,
        entryNumber,
      },
      {
        date: expense.date,
        description: `Expense payable: ${baseLabel}`,
        sourceTransactionId: expense.id,
        accountId: payableAccountId,
        debit: 0,
        credit: amount,
        businessId: expense.businessId ?? null,
        postingGroup: primaryPostingGroup,
        entryNumber,
      },
    ],
    skipDuplicates: true,
  });

  await tx.ledgerEntry.deleteMany({
    where: { postingGroup: settlementPostingGroup },
  });

  if (expense.isPaid && cashAccountId) {
    // Cleared-funds calculation: only cash + passed checks
    const checkAmount = Math.max(0, Math.min(Number(expense.check || 0), amount));
    const cashPortion = Math.max(0, amount - checkAmount);
    const passedCheckPortion =
      checkAmount > 0 && expense.checkStatus === 'Passed'
        ? checkAmount
        : 0;
    const settlementAmount = cashPortion + passedCheckPortion;

    // Only create settlement entries if there are cleared funds
    if (settlementAmount > 0) {
      const settlementDate = expense.paidAt ? new Date(expense.paidAt) : expense.date;
      const settlementEntryNumber = await resolveLedgerEntryNumber(tx, {
        postingGroup: settlementPostingGroup,
        date: settlementDate,
      });
      await tx.ledgerEntry.createMany({
        data: [
          {
            date: settlementDate,
            description: `Expense settlement: ${baseLabel}`,
            sourceTransactionId: expense.id,
            accountId: payableAccountId,
            debit: settlementAmount,
            credit: 0,
            businessId: expense.businessId ?? null,
            postingGroup: settlementPostingGroup,
            entryNumber: settlementEntryNumber,
          },
          {
            date: settlementDate,
            description: `Expense payment: ${baseLabel}`,
            sourceTransactionId: expense.id,
            accountId: cashAccountId,
            debit: 0,
            credit: settlementAmount,
            businessId: expense.businessId ?? null,
            postingGroup: settlementPostingGroup,
            entryNumber: settlementEntryNumber,
          },
        ],
        skipDuplicates: true,
      });
    }
  }
}


export type ExpensesPage = {
  items: ExpenseDTO[];
  total: number;
  pageSize: number;
  nextCursor?: string | null;
  hasMore?: boolean;
  summary?: {
    totalAmount: number;
    totalPaid: number;
    totalUnpaid: number;
  };
};

export async function getExpenses(params?: {
  categoryId?: string;
  businessId?: string;
  branchId?: string | null;
  branchIds?: string[];
  includeNullBranch?: boolean;
  from?: Date;
  to?: Date;
  isAdExpense?: boolean;
  platform?: OrderPlatform;
  accessibleBusinessIds?: string[];
  pageSize?: number;
  cursor?: string;
  search?: string;
  includeTotal?: boolean;
}): Promise<ExpensesPage> {
  const pageSize = Math.min(params?.pageSize && params.pageSize > 0 ? params.pageSize : 50, 200);
  const cursor = params?.cursor;

  const where: Prisma.ExpenseWhereInput = {};

  if (params?.categoryId) where.categoryId = params.categoryId;
  if (params?.businessId) where.businessId = params.businessId;
  if (typeof params?.isAdExpense === 'boolean') where.isAdExpense = params.isAdExpense;
  if (params?.platform) where.platform = params.platform;
  if (params?.includeNullBranch && params?.branchIds && params.branchIds.length > 0) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : (where.AND ? [where.AND] : [])),
      {
        OR: [
          { branchId: null },
          { branchId: { in: params.branchIds } }
        ]
      }
    ] as any;
  } else if (params?.includeNullBranch && (!params?.branchIds || params.branchIds.length === 0)) {
    where.branchId = null;
  } else if (params?.branchIds && params.branchIds.length > 0) {
    where.branchId = { in: params.branchIds };
  } else if (params?.branchId !== undefined) {
    where.branchId = params.branchId;
  }
  if (params?.from || params?.to) {
    where.date = {
      gte: params?.from,
      lte: params?.to,
    };
  }

  // Respect staff accessible businesses, but always include general expenses (businessId = null)
  if (params?.accessibleBusinessIds?.length) {
    where.OR = [
      { businessId: null },
      { businessId: { in: params.accessibleBusinessIds } },
    ];
  }

  if (params?.search) {
    const q = params.search.trim();
    if (q) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : (where.AND ? [where.AND] : [])),
        {
          OR: [
            { notes: { contains: q, mode: 'insensitive' } },
            { ExpenseCategory: { name: { contains: q, mode: 'insensitive' } } },
            { StaffPayment: { staff: { name: { contains: q, mode: 'insensitive' } } } },
            { StaffPayment: { staff: { staffCode: { contains: q, mode: 'insensitive' } } } },
          ]
        }
      ] as any;
    }
  }

  const [rawItems, total, summary] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      cursor: cursor ? { id: cursor } : undefined,
      take: pageSize + 1,
      include: {
        ExpenseCategory: true,
        Business: true,
        Branch: true,
        StaffPayment: {
          select: {
            staffId: true,
            notes: true,
            staff: { select: { name: true, staffCode: true } },
          },
        },
      },
    }),
    params?.includeTotal ? prisma.expense.count({ where }) : Promise.resolve(0),
    params?.includeTotal ? prisma.expense.aggregate({
      where,
      _sum: { amount: true },
    }) : Promise.resolve({ _sum: { amount: 0 } }),
  ]);

  const hasMore = rawItems.length > pageSize;
  const items = hasMore ? rawItems.slice(0, pageSize) : rawItems;
  let nextCursor: string | null = null;
  if (hasMore) {
    const lastItem = items[items.length - 1];
    nextCursor = lastItem.id;
  }

  let expenseSummary: ExpensesPage['summary'] = undefined;

  if (params?.includeTotal) {
    // Calculate summary totals with cleared-funds logic
    const allExpenses = await prisma.expense.findMany({
      where,
      select: {
        amount: true,
        isPaid: true,
        check: true,
        checkStatus: true,
      },
    });

    let totalPaid = 0;
    let totalUnpaid = 0;

    allExpenses.forEach((exp) => {
      const amount = Number(exp.amount || 0);
      const checkAmount = Math.max(0, Math.min(Number(exp.check || 0), amount));
      const cashPortion = exp.isPaid ? Math.max(0, amount - checkAmount) : 0;
      const passedCheckPortion =
        exp.isPaid && exp.checkStatus === 'Passed' ? checkAmount : 0;
      const cleared = cashPortion + passedCheckPortion;

      totalPaid += cleared;
      totalUnpaid += amount - cleared;
    });

    const totalAmount = allExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

    expenseSummary = {
      totalAmount,
      totalPaid,
      totalUnpaid,
    };
  }

  return {
    items: items.map(mapDbExpenseToDto),
    total,
    pageSize,
    nextCursor,
    hasMore,
    summary: expenseSummary
  };
}

export async function createExpense(input: ExpenseInput): Promise<ExpenseDTO> {
  const date = normalizeDate(input.date);
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be a positive number');
  if (!input.categoryId) throw new Error('Category is required');

  const isAdExpense = Boolean(input.isAdExpense);
  const platform = isAdExpense ? input.platform ?? null : null;
  if (isAdExpense && !platform) throw new Error('Platform is required for ad expenses');

  const isPaid = Boolean(input.isPaid);
  const rawCheck = Number(input.check ?? 0);
  const checkAmount = Number.isFinite(rawCheck) ? rawCheck : 0;
  const hasCheck = isPaid && checkAmount > 0;
  const checkDate = hasCheck
    ? input.checkDate
      ? new Date(input.checkDate)
      : null
    : null;
  if (hasCheck && !input.checkNo) {
    throw new Error('Check payment requires a Check Number.');
  }
  if (hasCheck && !checkDate) {
    throw new Error('Check payment requires a check passing date.');
  }
  const checkStatus = hasCheck ? (input.checkStatus ?? 'Pending') : null;

  const paidAt =
    isPaid && input.paidAt
      ? new Date(input.paidAt)
      : isPaid
        ? new Date()
        : null;

  if (input.paidFromAccountId) {
    const account = await prisma.account.findUnique({ where: { id: input.paidFromAccountId } });
    if (account && account.name.toLowerCase().includes('cash')) {
      const { assertCashDrawerAccount } = await import('@/server/modules/cash-drawers');
      try {
        await assertCashDrawerAccount(input.paidFromAccountId);
      } catch (err: any) {
        throw new Error(err.message === 'CASH_DRAWER_INACTIVE' ? 'Selected Cash Drawer is inactive.' : 'Cash payments must specify a valid Cash Drawer.');
      }
    }
  }

  const expense = await prisma.$transaction(async (tx) => {
    const created = await tx.expense.create({
      data: {
        date,
        amount,
        notes: input.notes?.trim() ? input.notes.trim() : null,
        isAdExpense,
        platform,
        categoryId: input.categoryId,
        businessId: input.businessId || null,
        branchId: input.branchId || null,
        isPaid,
        paidFromAccountId: input.paidFromAccountId || null,
        payableAccountId: input.payableAccountId || null,
        check: hasCheck ? checkAmount : 0,
        checkNo: hasCheck ? input.checkNo : null,
        checkDate,
        checkStatus,
        paidAt,
        approvalStatus: input.approvalStatus ?? (input.staffPaymentId ? 'Approved' : 'Submitted'),
        submittedById: input.submittedById,
        submittedByName: input.submittedByName,
        submittedAt: new Date(),
        approvedById: input.approvalStatus === 'Approved' ? input.approvedById : null,
        approvedByName: input.approvalStatus === 'Approved' ? input.approvedByName : null,
        approvedAt: input.approvalStatus === 'Approved' ? new Date() : null,
      },
      include: {
        ExpenseCategory: true,
        Business: true,
        Branch: true,
        StaffPayment: {
          select: {
            staffId: true,
            notes: true,
            staff: { select: { name: true, staffCode: true } },
          },
        },
      },
    });

    await postExpenseLedger(tx, created, created.ExpenseCategory);

    if (created.approvalStatus === 'Approved') {
      const checkItem = await buildCheckPassingItemFromExpense(tx, created.id);
      if (checkItem) await upsertCheckPassingItem(tx, checkItem);
    } else {
      await deleteCheckPassingItem(tx, CheckPassingSource.Expense, created.id);
    }

    return created;
  });

  await revalidateTags(['expenses']);
  return mapDbExpenseToDto(expense);
}

export async function updateExpense(id: string, input: Partial<ExpenseInput>): Promise<ExpenseDTO> {
  if (!id) throw new Error('Expense id is required');

  const data: Prisma.ExpenseUpdateInput = {};
  if (typeof input.date === 'string') data.date = normalizeDate(input.date);
  if (typeof input.amount !== 'undefined') {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be a positive number');
    data.amount = amount;
  }
  if (typeof input.notes !== 'undefined') data.notes = input.notes?.trim() ? input.notes.trim() : null;
  if (typeof input.categoryId === 'string' && input.categoryId) data.ExpenseCategory = { connect: { id: input.categoryId } };
  if (typeof input.businessId !== 'undefined') data.Business = input.businessId ? { connect: { id: input.businessId } } : { disconnect: true };
  if (typeof input.branchId !== 'undefined') data.Branch = input.branchId ? { connect: { id: input.branchId } } : { disconnect: true };

  if (typeof input.isAdExpense === 'boolean') {
    data.isAdExpense = input.isAdExpense;
    data.platform = input.isAdExpense ? input.platform ?? null : null;
    if (input.isAdExpense && !data.platform) throw new Error('Platform is required for ad expenses');
  } else if (typeof input.platform !== 'undefined') {
    data.platform = input.platform;
  }

  if (typeof input.isPaid === 'boolean') data.isPaid = input.isPaid;
  if (typeof input.paidFromAccountId !== 'undefined') (data as any).paidFromAccountId = input.paidFromAccountId || null;
  if (typeof input.payableAccountId !== 'undefined') (data as any).payableAccountId = input.payableAccountId || null;
  if (typeof input.paidAt !== 'undefined') {
    data.paidAt = input.paidAt ? new Date(input.paidAt) : null;
  } else if (input.isPaid && !input.paidAt) {
    data.paidAt = new Date();
  }

  if (typeof input.paidById !== 'undefined') (data as any).paidById = input.paidById || null;
  if (typeof input.paidByName !== 'undefined') (data as any).paidByName = input.paidByName || null;

  if (input.isPaid === false) {
    (data as any).paidById = null;
    (data as any).paidByName = null;
  }

  // Handle Logic Transitions
  if (input.approvalStatus === 'Approved') {
    data.approvedById = input.approvedById;
    data.approvedByName = input.approvedByName;
    data.approvedAt = new Date();
  } else if (input.approvalStatus === 'Rejected') {
    data.rejectedById = input.rejectedById;
    data.rejectedByName = input.rejectedByName;
    data.rejectedAt = new Date();
    data.rejectionNote = input.rejectionNote;

    // Reset payment fields on rejection
    data.isPaid = false;
    data.paidAt = null;
    (data as any).paidFromAccountId = null;
    (data as any).paidById = null;
    (data as any).paidByName = null;
    data.check = 0;
    data.checkNo = null;
    data.checkDate = null;
    data.checkStatus = null;
  }

  if (input.approvalStatus) data.approvalStatus = input.approvalStatus;

  if (input.paidFromAccountId) {
    const account = await prisma.account.findUnique({ where: { id: input.paidFromAccountId } });
    if (account && account.name.toLowerCase().includes('cash')) {
      const { assertCashDrawerAccount } = await import('@/server/modules/cash-drawers');
      try {
        await assertCashDrawerAccount(input.paidFromAccountId);
      } catch (err: any) {
        throw new Error(err.message === 'CASH_DRAWER_INACTIVE' ? 'Selected Cash Drawer is inactive.' : 'Cash payments must specify a valid Cash Drawer.');
      }
    }
  }

  const expense = await prisma.$transaction(async (tx) => {
    const existing = await tx.expense.findUnique({
      where: { id },
      select: { isPaid: true, check: true, checkNo: true, checkDate: true, checkStatus: true },
    });
    if (!existing) throw new Error('Expense not found');

    const shouldUpdateCheck =
      typeof input.check !== 'undefined' ||
      typeof input.checkNo !== 'undefined' ||
      typeof input.checkDate !== 'undefined' ||
      typeof input.checkStatus !== 'undefined' ||
      typeof input.isPaid === 'boolean';

    if (shouldUpdateCheck) {
      const effectiveIsPaid =
        typeof input.isPaid === 'boolean' ? input.isPaid : Boolean(existing.isPaid);
      const rawCheck =
        typeof input.check !== 'undefined' ? Number(input.check ?? 0) : Number(existing.check ?? 0);
      const checkAmount = Number.isFinite(rawCheck) ? rawCheck : 0;
      const hasCheck = effectiveIsPaid && checkAmount > 0;
      const checkDate = hasCheck
        ? input.checkDate
          ? new Date(input.checkDate)
          : existing.checkDate
        : null;
      const checkNo = hasCheck
        ? (input.checkNo !== undefined ? input.checkNo : existing.checkNo)
        : null;

      if (hasCheck && !checkNo) {
        throw new Error('Check payment requires a Check Number.');
      }
      if (hasCheck && !checkDate) {
        throw new Error('Check payment requires a check passing date.');
      }
      const checkStatus =
        hasCheck
          ? (input.checkStatus ?? existing.checkStatus ?? 'Pending')
          : null;

      data.check = hasCheck ? checkAmount : 0;
      data.checkNo = checkNo;
      data.checkDate = checkDate;
      data.checkStatus = checkStatus;
    }

    const updated = await tx.expense.update({
      where: { id },
      data,
      include: {
        ExpenseCategory: true,
        Business: true,
        Branch: true,
        StaffPayment: {
          select: {
            staffId: true,
            notes: true,
            staff: { select: { name: true, staffCode: true } },
          },
        },
      },
    });
    await postExpenseLedger(tx, updated, updated.ExpenseCategory);

    if (updated.approvalStatus === 'Approved') {
      const checkItem = await buildCheckPassingItemFromExpense(tx, updated.id);
      if (checkItem) await upsertCheckPassingItem(tx, checkItem);
      else await deleteCheckPassingItem(tx, CheckPassingSource.Expense, updated.id);
    } else {
      await deleteCheckPassingItem(tx, CheckPassingSource.Expense, updated.id);
    }

    return updated;
  });

  await revalidateTags(['expenses']);
  return mapDbExpenseToDto(expense);
}

export async function updateExpenseCheckStatus(
  expenseId: string,
  status: CheckStatus,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const client = tx || prisma;

  const expense = await client.expense.findUnique({
    where: { id: expenseId },
    select: { id: true, checkStatus: true },
  });

  if (!expense) {
    throw new Error('Expense not found');
  }

  if (expense.checkStatus === status) {
    return; // No change needed
  }

  await client.expense.update({
    where: { id: expenseId },
    data: { checkStatus: status },
  });

  // Rebuild ledger with new status
  const updated = await client.expense.findUnique({
    where: { id: expenseId },
    include: {
      ExpenseCategory: true,
      Business: true,
      StaffPayment: {
        select: {
          staffId: true,
          notes: true,
          staff: { select: { name: true, staffCode: true } },
        },
      },
    },
  });

  if (updated) {
    if (tx) {
      await postExpenseLedger(tx, updated, updated.ExpenseCategory);
    } else {
      await prisma.$transaction(async (txn) => {
        await postExpenseLedger(txn, updated, updated.ExpenseCategory);
      });
    }
  }
}

export async function deleteExpense(id: string) {
  if (!id) throw new Error('Expense id is required');
  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.deleteMany({ where: { postingGroup: `expense:${id}` } });
    await tx.ledgerEntry.deleteMany({ where: { postingGroup: `expenseSettlement:${id}` } });
    await tx.checkPassingItem.deleteMany({ where: { source: CheckPassingSource.Expense, sourceId: id } });
    await tx.expense.delete({ where: { id } });
  });
  await revalidateTags(['expenses']);
  return { id, deleted: true };
}
