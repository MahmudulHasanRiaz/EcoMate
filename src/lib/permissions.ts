
import type { StaffMember, StaffRole, Permission } from '@/types';
import { getPresetPageAccess } from '@/lib/page-access';

// Permission presets for each role
const NO_ACCESS: Permission = { create: false, read: false, update: false, delete: false };
const READ_ONLY: Permission = { create: false, read: true, update: false, delete: false };
const CREATE_READ_UPDATE: Permission = { create: true, read: true, update: true, delete: false };
const FULL_ACCESS: Permission = { create: true, read: true, update: true, delete: true };

const EMPTY_PERMISSIONS: StaffMember['permissions'] = {
    orders: NO_ACCESS,
    packingOrders: NO_ACCESS,
    products: NO_ACCESS,
    inventory: NO_ACCESS,
    customers: NO_ACCESS,
    purchases: NO_ACCESS,
    expenses: NO_ACCESS,
    checkPassing: NO_ACCESS,
    partners: NO_ACCESS,
    courierReport: NO_ACCESS,
    courierManagement: NO_ACCESS,
    staff: NO_ACCESS,
    settings: NO_ACCESS,
    analytics: NO_ACCESS,
    issues: NO_ACCESS,
    attendance: NO_ACCESS,
    accounting: NO_ACCESS,
    marketing: NO_ACCESS,
    integrations: NO_ACCESS,
    tasks: CREATE_READ_UPDATE,
    pageAccess: getPresetPageAccess('Custom'),
};

const withPageAccess = (role: StaffRole, permissions: Omit<StaffMember['permissions'], 'pageAccess'>): StaffMember['permissions'] => ({
    ...permissions,
    pageAccess: getPresetPageAccess(role),
});

export const PERMISSIONS: Record<StaffRole, StaffMember['permissions']> = {
    SuperAdmin: withPageAccess('SuperAdmin', {
        orders: FULL_ACCESS, packingOrders: FULL_ACCESS, products: FULL_ACCESS, inventory: FULL_ACCESS,
        customers: FULL_ACCESS, purchases: FULL_ACCESS, expenses: FULL_ACCESS, checkPassing: FULL_ACCESS,
        partners: FULL_ACCESS, courierReport: FULL_ACCESS, courierManagement: FULL_ACCESS, staff: FULL_ACCESS,
        settings: FULL_ACCESS, analytics: FULL_ACCESS, issues: FULL_ACCESS, attendance: FULL_ACCESS,
        accounting: FULL_ACCESS, marketing: FULL_ACCESS, integrations: FULL_ACCESS, tasks: FULL_ACCESS,
    }),
    Admin: withPageAccess('Admin', {
        orders: FULL_ACCESS, packingOrders: FULL_ACCESS, products: FULL_ACCESS, inventory: FULL_ACCESS,
        customers: FULL_ACCESS, purchases: FULL_ACCESS, expenses: FULL_ACCESS, checkPassing: FULL_ACCESS,
        partners: FULL_ACCESS, courierReport: FULL_ACCESS, courierManagement: FULL_ACCESS, staff: FULL_ACCESS,
        settings: FULL_ACCESS, analytics: FULL_ACCESS, issues: FULL_ACCESS, attendance: FULL_ACCESS,
        accounting: FULL_ACCESS, marketing: FULL_ACCESS, integrations: FULL_ACCESS, tasks: FULL_ACCESS,
    }),
    Manager: withPageAccess('Manager', {
        orders: CREATE_READ_UPDATE, packingOrders: READ_ONLY, products: CREATE_READ_UPDATE, inventory: CREATE_READ_UPDATE,
        customers: CREATE_READ_UPDATE, purchases: CREATE_READ_UPDATE, expenses: CREATE_READ_UPDATE,
        checkPassing: { ...CREATE_READ_UPDATE, create: false }, partners: CREATE_READ_UPDATE, courierReport: READ_ONLY,
        courierManagement: CREATE_READ_UPDATE, staff: { ...CREATE_READ_UPDATE, delete: false }, settings: READ_ONLY,
        analytics: NO_ACCESS, issues: CREATE_READ_UPDATE, attendance: READ_ONLY, accounting: CREATE_READ_UPDATE,
        marketing: READ_ONLY, integrations: FULL_ACCESS, tasks: FULL_ACCESS,
    }),
    'Modarator Manager': withPageAccess('Modarator Manager', {
        orders: CREATE_READ_UPDATE, packingOrders: { ...CREATE_READ_UPDATE, create: false, delete: false }, products: READ_ONLY, inventory: READ_ONLY,
        customers: CREATE_READ_UPDATE, purchases: NO_ACCESS, expenses: { ...CREATE_READ_UPDATE, update: false, delete: false }, checkPassing: NO_ACCESS,
        partners: READ_ONLY, courierReport: { ...CREATE_READ_UPDATE, create: false, delete: false }, courierManagement: NO_ACCESS, staff: { ...CREATE_READ_UPDATE, delete: false },
        settings: NO_ACCESS, analytics: READ_ONLY, issues: CREATE_READ_UPDATE, attendance: { ...CREATE_READ_UPDATE, delete: false },
        accounting: { ...CREATE_READ_UPDATE, delete: false }, marketing: NO_ACCESS, integrations: NO_ACCESS, tasks: CREATE_READ_UPDATE,
    }),
    'Project Manager': withPageAccess('Project Manager', {
        orders: READ_ONLY, packingOrders: READ_ONLY, products: READ_ONLY, inventory: READ_ONLY,
        customers: READ_ONLY, purchases: READ_ONLY, expenses: READ_ONLY, checkPassing: READ_ONLY,
        partners: READ_ONLY, courierReport: READ_ONLY, courierManagement: READ_ONLY, staff: { create: true, read: true, update: true, delete: false },
        settings: READ_ONLY, analytics: NO_ACCESS, issues: CREATE_READ_UPDATE, attendance: READ_ONLY,
        accounting: READ_ONLY, marketing: READ_ONLY, integrations: READ_ONLY, tasks: CREATE_READ_UPDATE,
    }),
    'Office Assistant': withPageAccess('Office Assistant', {
        orders: NO_ACCESS, packingOrders: NO_ACCESS, products: NO_ACCESS, inventory: NO_ACCESS,
        customers: NO_ACCESS, purchases: NO_ACCESS, expenses: NO_ACCESS, checkPassing: NO_ACCESS,
        partners: NO_ACCESS, courierReport: NO_ACCESS, courierManagement: NO_ACCESS, staff: NO_ACCESS,
        settings: NO_ACCESS, analytics: NO_ACCESS, issues: NO_ACCESS, attendance: NO_ACCESS,
        accounting: NO_ACCESS, marketing: NO_ACCESS, integrations: NO_ACCESS, tasks: NO_ACCESS,
    }),
    Moderator: withPageAccess('Moderator', {
        orders: CREATE_READ_UPDATE, packingOrders: NO_ACCESS, products: READ_ONLY, inventory: NO_ACCESS,
        customers: READ_ONLY, purchases: NO_ACCESS, expenses: NO_ACCESS, checkPassing: NO_ACCESS,
        partners: READ_ONLY, courierReport: READ_ONLY, courierManagement: READ_ONLY, staff: READ_ONLY,
        settings: READ_ONLY, analytics: NO_ACCESS, issues: CREATE_READ_UPDATE, attendance: NO_ACCESS,
        accounting: READ_ONLY, marketing: NO_ACCESS, integrations: NO_ACCESS, tasks: CREATE_READ_UPDATE,
    }),
    'Packing Assistant': withPageAccess('Packing Assistant', {
        orders: NO_ACCESS, packingOrders: { ...CREATE_READ_UPDATE, create: false, delete: false }, products: NO_ACCESS,
        inventory: NO_ACCESS, customers: NO_ACCESS, purchases: NO_ACCESS, expenses: NO_ACCESS, checkPassing: NO_ACCESS,
        partners: NO_ACCESS, courierReport: NO_ACCESS, courierManagement: NO_ACCESS, staff: NO_ACCESS,
        settings: NO_ACCESS, analytics: NO_ACCESS, issues: NO_ACCESS, attendance: NO_ACCESS,
        accounting: CREATE_READ_UPDATE, marketing: NO_ACCESS, integrations: NO_ACCESS, tasks: CREATE_READ_UPDATE,
    }),
    'Seller': withPageAccess('Seller', {
        orders: CREATE_READ_UPDATE, packingOrders: READ_ONLY, products: READ_ONLY, inventory: READ_ONLY,
        customers: CREATE_READ_UPDATE, purchases: NO_ACCESS, expenses: NO_ACCESS, checkPassing: NO_ACCESS,
        partners: READ_ONLY, courierReport: READ_ONLY, courierManagement: READ_ONLY, staff: READ_ONLY,
        settings: READ_ONLY, analytics: NO_ACCESS, issues: READ_ONLY, attendance: NO_ACCESS,
        accounting: READ_ONLY, marketing: NO_ACCESS, integrations: NO_ACCESS, tasks: CREATE_READ_UPDATE,
    }),
    'Call Assistant': withPageAccess('Call Assistant', {
        orders: CREATE_READ_UPDATE, packingOrders: NO_ACCESS, products: READ_ONLY, inventory: READ_ONLY,
        customers: READ_ONLY, purchases: NO_ACCESS, expenses: NO_ACCESS, checkPassing: NO_ACCESS,
        partners: NO_ACCESS, courierReport: READ_ONLY, courierManagement: READ_ONLY, staff: NO_ACCESS,
        settings: NO_ACCESS, analytics: NO_ACCESS, issues: READ_ONLY, attendance: NO_ACCESS,
        accounting: CREATE_READ_UPDATE, marketing: NO_ACCESS, integrations: NO_ACCESS, tasks: CREATE_READ_UPDATE,
    }),
    'Call Centre Manager': withPageAccess('Call Centre Manager', {
        orders: CREATE_READ_UPDATE, packingOrders: { ...CREATE_READ_UPDATE, create: false, delete: false }, products: READ_ONLY, inventory: READ_ONLY,
        customers: CREATE_READ_UPDATE, purchases: NO_ACCESS, expenses: { ...CREATE_READ_UPDATE, update: false, delete: false }, checkPassing: NO_ACCESS,
        partners: READ_ONLY, courierReport: { ...CREATE_READ_UPDATE, create: false, delete: false }, courierManagement: NO_ACCESS, staff: { ...CREATE_READ_UPDATE, delete: false },
        settings: NO_ACCESS, analytics: READ_ONLY, issues: CREATE_READ_UPDATE, attendance: { ...CREATE_READ_UPDATE, delete: false },
        accounting: { ...CREATE_READ_UPDATE, delete: false }, marketing: NO_ACCESS, integrations: NO_ACCESS, tasks: CREATE_READ_UPDATE,
    }),
    'Courier Manager': withPageAccess('Courier Manager', {
        orders: { ...CREATE_READ_UPDATE, create: false, delete: false }, packingOrders: READ_ONLY, products: NO_ACCESS,
        inventory: NO_ACCESS, customers: READ_ONLY, purchases: NO_ACCESS, expenses: NO_ACCESS, checkPassing: READ_ONLY,
        partners: NO_ACCESS, courierReport: FULL_ACCESS, courierManagement: FULL_ACCESS, staff: READ_ONLY,
        settings: { ...NO_ACCESS, read: true }, analytics: NO_ACCESS, issues: CREATE_READ_UPDATE,
        attendance: NO_ACCESS, accounting: CREATE_READ_UPDATE, marketing: NO_ACCESS, integrations: NO_ACCESS,
        tasks: CREATE_READ_UPDATE,
    }),
    'Courier Call Assistant': withPageAccess('Courier Call Assistant', {
        orders: READ_ONLY, packingOrders: NO_ACCESS, products: NO_ACCESS, inventory: NO_ACCESS,
        customers: READ_ONLY, purchases: NO_ACCESS, expenses: NO_ACCESS, checkPassing: NO_ACCESS,
        partners: NO_ACCESS, courierReport: READ_ONLY, courierManagement: READ_ONLY, staff: NO_ACCESS,
        settings: NO_ACCESS, analytics: NO_ACCESS, issues: READ_ONLY, attendance: NO_ACCESS,
        accounting: CREATE_READ_UPDATE, marketing: NO_ACCESS, integrations: NO_ACCESS, tasks: CREATE_READ_UPDATE,
    }),
    'Vendor/Supplier': withPageAccess('Vendor/Supplier', {
        orders: NO_ACCESS, packingOrders: NO_ACCESS, products: NO_ACCESS, inventory: NO_ACCESS,
        customers: NO_ACCESS, purchases: { create: false, read: true, update: true, delete: false },
        expenses: NO_ACCESS, checkPassing: NO_ACCESS, partners: NO_ACCESS, courierReport: NO_ACCESS,
        courierManagement: NO_ACCESS, staff: NO_ACCESS, settings: NO_ACCESS, analytics: NO_ACCESS,
        issues: NO_ACCESS, attendance: NO_ACCESS, accounting: CREATE_READ_UPDATE, marketing: NO_ACCESS,
        integrations: NO_ACCESS, tasks: CREATE_READ_UPDATE,
    }),
    'Partner': withPageAccess('Partner', {
        orders: NO_ACCESS, packingOrders: NO_ACCESS, products: NO_ACCESS, inventory: NO_ACCESS,
        customers: NO_ACCESS, purchases: { create: false, read: true, update: true, delete: false },
        expenses: NO_ACCESS, checkPassing: NO_ACCESS, partners: CREATE_READ_UPDATE, courierReport: NO_ACCESS,
        courierManagement: NO_ACCESS, staff: NO_ACCESS, settings: NO_ACCESS, analytics: NO_ACCESS,
        issues: NO_ACCESS, attendance: NO_ACCESS, accounting: CREATE_READ_UPDATE, marketing: NO_ACCESS,
        integrations: NO_ACCESS, tasks: CREATE_READ_UPDATE,
    }),
    'Cutting Master': withPageAccess('Cutting Master', {
        orders: NO_ACCESS, packingOrders: NO_ACCESS, products: NO_ACCESS, inventory: NO_ACCESS,
        customers: NO_ACCESS, purchases: READ_ONLY, expenses: NO_ACCESS, checkPassing: NO_ACCESS,
        partners: NO_ACCESS, courierReport: NO_ACCESS, courierManagement: NO_ACCESS, staff: NO_ACCESS,
        settings: NO_ACCESS, analytics: NO_ACCESS, issues: NO_ACCESS, attendance: NO_ACCESS,
        accounting: NO_ACCESS, marketing: NO_ACCESS, integrations: NO_ACCESS, tasks: CREATE_READ_UPDATE,
    }),
    'Marketer': withPageAccess('Marketer', {
        orders: NO_ACCESS, packingOrders: NO_ACCESS, products: NO_ACCESS, inventory: NO_ACCESS,
        customers: NO_ACCESS, purchases: NO_ACCESS, expenses: NO_ACCESS, checkPassing: NO_ACCESS,
        partners: NO_ACCESS, courierReport: NO_ACCESS, courierManagement: NO_ACCESS, staff: NO_ACCESS,
        settings: NO_ACCESS, analytics: NO_ACCESS, issues: NO_ACCESS, attendance: NO_ACCESS,
        accounting: NO_ACCESS, marketing: FULL_ACCESS, integrations: NO_ACCESS, tasks: CREATE_READ_UPDATE,
    }),
    'Finance Manager': withPageAccess('Finance Manager', {
        orders: NO_ACCESS, packingOrders: NO_ACCESS, products: NO_ACCESS, inventory: NO_ACCESS,
        customers: NO_ACCESS, purchases: NO_ACCESS, expenses: CREATE_READ_UPDATE, checkPassing: CREATE_READ_UPDATE,
        partners: CREATE_READ_UPDATE, courierReport: NO_ACCESS, courierManagement: CREATE_READ_UPDATE, staff: { create: false, read: true, update: true, delete: false },
        settings: NO_ACCESS, analytics: NO_ACCESS, issues: NO_ACCESS, attendance: NO_ACCESS,
        accounting: CREATE_READ_UPDATE, marketing: NO_ACCESS, integrations: NO_ACCESS, tasks: CREATE_READ_UPDATE,
    }),
    'Custom': EMPTY_PERMISSIONS,
};
