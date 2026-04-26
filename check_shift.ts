import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const settingRecord = await prisma.appSetting.findUnique({ where: { key: 'general' } });
  const settings = (settingRecord?.value ?? {}) as {
    workStartTime?: string | null;
    lateGraceMinutes?: number | null;
  };
  const staff = await prisma.staffMember.findFirst({ where: { name: 'Md Mahmudul Hasan Riaz' }});
  const overrides = await prisma.staffShiftOverride.findFirst({ where: { staffId: staff?.id }});
  const role = await prisma.shiftTemplate.findFirst({ where: { role: staff?.role }});
  
  console.log({
    workStartTime: settings?.workStartTime,
    lateGraceMinutes: settings?.lateGraceMinutes,
    staffRole: staff?.role,
    override: overrides,
    roleTemplate: role,
  });
}
run().finally(() => prisma.$disconnect());
