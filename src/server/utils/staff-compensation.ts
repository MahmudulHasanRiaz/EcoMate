type SalaryInput = any;
type CommissionInput = any;

export function normalizeSalaryDetails(
  paymentType: string | undefined,
  salaryDetails?: SalaryInput,
) {
  if (paymentType !== 'Salary' && paymentType !== 'Both') return {};
  const amount = Number(salaryDetails?.amount ?? 0);
  const frequency = salaryDetails?.frequency || 'Monthly';
  return { amount, frequency };
}

export function normalizeCommissionDetails(
  paymentType: string | undefined,
  commissionDetails?: CommissionInput,
) {
  if (paymentType !== 'Commission' && paymentType !== 'Both') return {};
  return {
    targetEnabled: Boolean(commissionDetails?.targetEnabled),
    targetPeriod: commissionDetails?.targetPeriod || null,
    targetCount: Number(commissionDetails?.targetCount ?? 0),
    onOrderCreate: commissionDetails?.onOrderCreate != null ? Number(commissionDetails.onOrderCreate) : undefined,
    onOrderConfirm: commissionDetails?.onOrderConfirm != null ? Number(commissionDetails.onOrderConfirm) : undefined,
    onOrderPacked: commissionDetails?.onOrderPacked != null ? Number(commissionDetails.onOrderPacked) : undefined,
    onOrderConvert: commissionDetails?.onOrderConvert != null ? Number(commissionDetails.onOrderConvert) : undefined,
  };
}

