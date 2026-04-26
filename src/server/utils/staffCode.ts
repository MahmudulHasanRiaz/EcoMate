import prisma from '@/lib/prisma';

const MIN_CODE_LENGTH = 3;
const numericCode = /^\d+$/;

export async function generateStaffCode() {
  const staffCodes = await prisma.staffMember.findMany({
    select: { staffCode: true },
  });

  let max = 0;
  staffCodes.forEach(({ staffCode }) => {
    const raw = String(staffCode || '').trim();
    if (!numericCode.test(raw)) return;
    const value = Number(raw);
    if (Number.isFinite(value)) max = Math.max(max, value);
  });

  const next = max + 1;
  return String(next).padStart(MIN_CODE_LENGTH, '0');
}
