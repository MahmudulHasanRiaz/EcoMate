import { z } from 'zod';

const staffRoleSchema = z.enum([
  'Admin',
  'Manager',
  'Project Manager',
  'Office Assistant',
  'Moderator',
  'Seller',
  'Packing Assistant',
  'Call Assistant',
  'Call Centre Manager',
  'Courier Manager',
  'Courier Call Assistant',
  'Partner',
  'Vendor/Supplier',
  'Custom',
  'PackingAssistant',
  'CallAssistant',
  'CallCentreManager',
  'CourierManager',
  'CourierCallAssistant',
  'Vendor_Supplier',
  'Cutting Master',
  'CuttingMan',
  'Marketer',
  'Finance Manager',
  'FinanceManager',
  'Modarator Manager',
  'ModaratorManager',
  'Project Manager',
  'ProjectManager',
]);

const paymentTypeSchema = z.enum(['Salary', 'Commission', 'Both']);

const salaryDetailsSchema = z.object({
  amount: z.number().min(0).optional(),
  frequency: z.string().optional(),
});

const commissionDetailsSchema = z.object({
  onOrderCreate: z.number().min(0).optional(),
  onOrderConfirm: z.number().min(0).optional(),
  onOrderPacked: z.number().min(0).optional(),
  onOrderConvert: z.number().min(0).optional(),
  targetEnabled: z.boolean().optional(),
  targetPeriod: z.enum(['Daily', 'Weekly', 'Monthly']).optional().nullable(),
  targetCount: z.number().min(0).optional(),
});

const baseStaffSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  role: staffRoleSchema,
  workType: z.enum(['Office', 'Remote']).default('Remote'),
  designation: z.string().optional().nullable(),
  paymentType: paymentTypeSchema,
  salaryDetails: salaryDetailsSchema.optional(),
  commissionDetails: commissionDetailsSchema.optional(),
  overtimeEligible: z.boolean().optional(),
  overtimeBonusPercent: z.number().min(0).optional().nullable(),
  permissions: z.any().optional(),
  accessibleBusinessIds: z.array(z.string()).optional(),
  staffCode: z.string().optional(),
  clerkId: z.string().optional(),
  weekendDays: z.array(z.number()).optional().nullable(),
  shiftOverride: z.object({
    startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Must be HH:mm'),
    endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Must be HH:mm'),
    lateGraceMinutes: z.number().min(0).optional(),
    earlyLeaveGraceMinutes: z.number().min(0).optional(),
  }).optional().nullable(),
  jobStartDate: z.string().optional().nullable(),
  jobEndDate: z.string().optional().nullable(),
});

const jobDateRefine = <T extends { jobStartDate?: string | null; jobEndDate?: string | null }>(
  data: T
) => {
  if (data.jobStartDate && data.jobEndDate) {
    return data.jobEndDate >= data.jobStartDate;
  }
  return true;
};

export const createStaffSchema = baseStaffSchema.refine(jobDateRefine, {
  message: 'Job end date must be on or after job start date',
  path: ['jobEndDate'],
});

export const updateStaffSchema = baseStaffSchema.partial().refine(jobDateRefine, {
  message: 'Job end date must be on or after job start date',
  path: ['jobEndDate'],
});
