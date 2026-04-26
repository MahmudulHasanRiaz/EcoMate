import prisma from '@/lib/prisma';
import { getGeneralSettings } from '@/server/utils/app-settings';

type EffectiveShift = {
  startTime: string;
  endTime: string;
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
  source: 'override' | 'template' | 'global';
};

/**
 * Resolve effective shift for a staff member:
 *  1. StaffShiftOverride (isActive=true) -> use it
 *  2. ShiftTemplate for role (isActive=true) -> use it
 *  3. Fall back to global workStartTime / lateGraceMinutes
 */
export async function getEffectiveShift(staffId: string, staffRole?: string): Promise<EffectiveShift> {
  // 1. Per-staff override
  const override = await prisma.staffShiftOverride.findFirst({
    where: { staffId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (override) {
    return {
      startTime: override.startTime,
      endTime: override.endTime,
      lateGraceMinutes: override.lateGraceMinutes,
      earlyLeaveGraceMinutes: override.earlyLeaveGraceMinutes,
      source: 'override',
    };
  }

  // 2. Role-based template
  if (staffRole) {
    const template = await prisma.shiftTemplate.findFirst({
      where: { role: staffRole as any, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    if (template) {
      return {
        startTime: template.startTime,
        endTime: template.endTime,
        lateGraceMinutes: template.lateGraceMinutes,
        earlyLeaveGraceMinutes: template.earlyLeaveGraceMinutes,
        source: 'template',
      };
    }
  }

  // 2.5. Global active template (role = null/empty) for everyone
  const globalTemplate = await prisma.shiftTemplate.findFirst({
    where: {
      isActive: true,
      role: null,
    },
    orderBy: { createdAt: 'desc' },
  });
  if (globalTemplate) {
    return {
      startTime: globalTemplate.startTime,
      endTime: globalTemplate.endTime,
      lateGraceMinutes: globalTemplate.lateGraceMinutes,
      earlyLeaveGraceMinutes: globalTemplate.earlyLeaveGraceMinutes,
      source: 'template',
    };
  }

  // 3. Global defaults
  const settings = await getGeneralSettings();
  return {
    startTime: settings.workStartTime || '09:00',
    endTime: '18:00', // default end time
    lateGraceMinutes: settings.lateGraceMinutes ?? 0,
    earlyLeaveGraceMinutes: 0,
    source: 'global',
  };
}

export function shiftExpectedMinutes(shift: EffectiveShift): number {
  const [sh, sm] = shift.startTime.split(':').map(Number);
  const [eh, em] = shift.endTime.split(':').map(Number);
  if (!Number.isFinite(sh) || !Number.isFinite(eh)) return 480; // 8h fallback
  let totalMin = (eh * 60 + em) - (sh * 60 + sm);
  if (totalMin <= 0) totalMin += 24 * 60; // overnight shift
  return totalMin;
}

// --- CRUD for ShiftTemplate ---

export async function listShiftTemplates() {
  return prisma.shiftTemplate.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function createShiftTemplate(data: {
  name: string;
  role?: string;
  startTime: string;
  endTime: string;
  lateGraceMinutes?: number;
  earlyLeaveGraceMinutes?: number;
}) {
  return prisma.shiftTemplate.create({
    data: {
      name: data.name,
      role: data.role as any,
      startTime: data.startTime,
      endTime: data.endTime,
      lateGraceMinutes: data.lateGraceMinutes ?? 0,
      earlyLeaveGraceMinutes: data.earlyLeaveGraceMinutes ?? 0,
    },
  });
}

export async function updateShiftTemplate(id: string, data: Partial<{
  name: string;
  role: string | null;
  startTime: string;
  endTime: string;
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
  isActive: boolean;
}>) {
  return prisma.shiftTemplate.update({ where: { id }, data: data as any });
}

export async function deleteShiftTemplate(id: string) {
  return prisma.shiftTemplate.delete({ where: { id } });
}

// --- CRUD for StaffShiftOverride ---

export async function getStaffShiftOverride(staffId: string) {
  return prisma.staffShiftOverride.findFirst({
    where: { staffId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function upsertStaffShiftOverride(staffId: string, data: {
  startTime: string;
  endTime: string;
  lateGraceMinutes?: number;
  earlyLeaveGraceMinutes?: number;
}) {
  // Deactivate old overrides
  await prisma.staffShiftOverride.updateMany({
    where: { staffId, isActive: true },
    data: { isActive: false },
  });

  return prisma.staffShiftOverride.create({
    data: {
      staffId,
      startTime: data.startTime,
      endTime: data.endTime,
      lateGraceMinutes: data.lateGraceMinutes ?? 0,
      earlyLeaveGraceMinutes: data.earlyLeaveGraceMinutes ?? 0,
    },
  });
}

export async function deleteStaffShiftOverride(staffId: string) {
  return prisma.staffShiftOverride.updateMany({
    where: { staffId, isActive: true },
    data: { isActive: false },
  });
}
