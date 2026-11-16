import { ConflictException, Injectable } from '@nestjs/common';
import { CmsPagesService } from '../cms-pages/cms-pages.service';
import { EMPLOYEE_DEFAULT_PERMISSIONS } from '../common/permissions/effective-permissions';
import { getAllPermissions } from '../common/permissions/registry';
import { PrismaService } from '../prisma/prisma.service';
import { tenantCompound } from '../tenancy/tenant-context';
import { ORDER_TRANSITIONS } from '../orders/order-transitions';
import { ProvisionTenantDto } from './dto/provision-tenant.dto';
import { RollbackProvisioningDto } from './dto/rollback-provisioning.dto';

const ORDER_STATUSES = [
  { name: 'Pending', color: '#F59E0B', isInitial: true, isFinal: false, sortOrder: 0 },
  { name: 'Payment Pending', color: '#F59E0B', isInitial: false, isFinal: false, sortOrder: 1 },
  { name: 'Payment Verifying', color: '#8B5CF6', isInitial: false, isFinal: false, sortOrder: 2 },
  { name: 'Hold', color: '#D97706', isInitial: false, isFinal: false, sortOrder: 3 },
  { name: 'Recall', color: '#F97316', isInitial: false, isFinal: false, sortOrder: 4 },
  { name: 'No Response', color: '#64748B', isInitial: false, isFinal: false, sortOrder: 5 },
  { name: 'Confirmed', color: '#3B82F6', isInitial: false, isFinal: false, sortOrder: 6 },
  { name: 'Packed', color: '#059669', isInitial: false, isFinal: false, sortOrder: 7 },
  { name: 'Packing Hold', color: '#D97706', isInitial: false, isFinal: false, sortOrder: 8 },
  { name: 'Shipping', color: '#06B6D4', isInitial: false, isFinal: false, sortOrder: 9 },
  { name: 'Delivered', color: '#10B981', isInitial: false, isFinal: true, sortOrder: 10 },
  { name: 'Partial', color: '#F59E0B', isInitial: false, isFinal: false, sortOrder: 11 },
  { name: 'Return Pending', color: '#EC4899', isInitial: false, isFinal: false, sortOrder: 12 },
  { name: 'Returned', color: '#DC2626', isInitial: false, isFinal: true, sortOrder: 13 },
  { name: 'Damaged', color: '#991B1B', isInitial: false, isFinal: true, sortOrder: 14 },
  { name: 'Cancelled', color: '#EF4444', isInitial: false, isFinal: true, sortOrder: 15 },
];

const PAYMENT_OPTIONS = [
  {
    type: 'CASH_ON_DELIVERY' as const,
    name: 'Cash on Delivery',
    description: 'Pay in cash when order is delivered',
    sortOrder: 3,
  },
];

/**
 * Idempotent seed for a newly provisioned tenant.
 *
 * Runs inside the request's tenant context (`runWithTenant`), so every
 * tenant-scoped write is RLS-bound. Every step is create-only / find-first:
 * retrying a failed provisioning job must never duplicate rows or overwrite
 * settings the owner has already changed.
 */
@Injectable()
export class TenantBootstrapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cmsPages: CmsPagesService,
  ) {}

  async bootstrap(dto: ProvisionTenantDto) {
    const ownerUserId = await this.ensureOwner(dto);
    const presetsCreated = await this.ensurePresets();
    const statusCount = await this.ensureOrderStatuses();
    const settingCount = await this.ensureSettings(dto);
    const warehousesCreated = await this.ensureWarehouse();
    const storeLocationsCreated = await this.ensureStoreLocation();
    await this.ensurePayment();
    const emailTemplatesCreated = await this.ensureEmailTemplates();
    // Runs last so contact/about/shipping pages can pick up the settings above.
    const pagesCreated = await this.cmsPages.ensureTemplatePages();

    // Sample catalog data is deliberately never seeded here: a new tenant
    // starts empty and demo data remains an explicit import action.
    return {
      tenantId: dto.tenantId,
      slug: dto.slug,
      ownerUserId,
      presetsCreated,
      orderStatusesCreated: statusCount,
      settingsCreated: settingCount,
      warehousesCreated,
      storeLocationsCreated,
      emailTemplatesCreated,
      pagesCreated,
    };
  }

  private async ensurePresets(): Promise<number> {
    const presets = [
      {
        name: 'Manager',
        description: 'Full store management access (built-in)',
        permissions: getAllPermissions(),
      },
      {
        name: 'Staff',
        description: 'Everyday staff access (built-in)',
        permissions: [...EMPLOYEE_DEFAULT_PERMISSIONS],
      },
    ];

    let created = 0;
    for (const preset of presets) {
      const existing = await this.prisma.accessPreset.findFirst({
        where: { name: preset.name },
        select: { id: true },
      });
      if (existing) continue;
      await this.prisma.accessPreset.create({
        data: { ...preset, isSystem: true },
      });
      created++;
    }
    return created;
  }

  /**
   * Removes a partial bootstrap seed. Deliberately refuses once business data
   * exists; a workspace that ever had an order/product/employee is not a
   * failed seed and must never be erased by an automated retry.
   */
  async rollback(dto: RollbackProvisioningDto) {
    const [orders, products, employees] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.product.count(),
      this.prisma.employee.count(),
    ]);
    if (orders > 0 || products > 0 || employees > 0) {
      throw new ConflictException(
        'Tenant already contains business data; refusing to roll back the bootstrap seed',
      );
    }

    const users = await this.prisma.userProfile.findMany({
      select: { id: true },
    });
    const deleted = {
      cmsPages: (await this.prisma.cmsPage.deleteMany()).count,
      emailTemplates: (await this.prisma.emailTemplate.deleteMany()).count,
      accessPresets: (await this.prisma.accessPreset.deleteMany()).count,
      paymentGateways: (await this.prisma.paymentGateway.deleteMany()).count,
      orderStatusTransitions: (
        await this.prisma.orderStatusTransition.deleteMany()
      ).count,
      orderStatuses: (await this.prisma.orderStatus.deleteMany()).count,
      systemSettings: (await this.prisma.systemSetting.deleteMany()).count,
      storeLocations: (await this.prisma.storeLocation.deleteMany()).count,
      warehouses: (await this.prisma.warehouse.deleteMany()).count,
      userSettings:
        users.length > 0
          ? (
              await this.prisma.userSettings.deleteMany({
                where: { userId: { in: users.map((user) => user.id) } },
              })
            ).count
          : 0,
      users: (await this.prisma.userProfile.deleteMany()).count,
    };

    return { tenantId: dto.tenantId, slug: dto.slug, deleted };
  }

  private async ensureOwner(dto: ProvisionTenantDto): Promise<string> {
    const existing = await this.prisma.userProfile.findFirst({
      where: { email: dto.ownerEmail },
      select: { id: true },
    });
    if (existing) return existing.id;

    const [rawFirst, ...rest] = (
      dto.ownerName ||
      dto.name ||
      'Store Owner'
    )
      .trim()
      .split(/\s+/);
    const firstName = rawFirst || 'Store';
    const lastName = rest.join(' ') || 'Owner';

    const baseUsername = (dto.ownerEmail.split('@')[0] || dto.slug)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'owner';
    let username = baseUsername;
    let suffix = 1;
    while (
      await this.prisma.userProfile.findFirst({
        where: { username },
        select: { id: true },
      })
    ) {
      username = `${baseUsername}-${suffix++}`;
    }

    const owner = await this.prisma.userProfile.create({
      data: {
        firstName,
        lastName,
        username,
        email: dto.ownerEmail,
        phoneNumber: dto.ownerPhone || '',
        password: dto.passwordHash,
        role: 'superadmin',
        status: 'active',
        emailVerified: true,
      },
      select: { id: true },
    });
    return owner.id;
  }

  private async ensureOrderStatuses(): Promise<number> {
    const map: Record<string, string> = {};
    const created = new Set<string>();

    for (const status of ORDER_STATUSES) {
      const existing = await this.prisma.orderStatus.findFirst({
        where: { name: status.name },
        select: { id: true },
      });
      if (existing) {
        map[status.name] = existing.id;
        continue;
      }
      const row = await this.prisma.orderStatus.create({
        data: { ...status, nextStatuses: [] },
        select: { id: true },
      });
      map[status.name] = row.id;
      created.add(status.name);
    }

    // Mirrors the seed rule: transitions are written only for statuses this
    // run created, never overwriting an installation's configured rules.
    for (const [name, nextNames] of Object.entries(ORDER_TRANSITIONS)) {
      if (!created.has(name)) continue;
      const ids = nextNames.map((next) => map[next]).filter(Boolean);
      if (ids.length === 0) continue;
      await this.prisma.orderStatus.update({
        where: { id: map[name] },
        data: { nextStatuses: ids },
      });
    }
    return created.size;
  }

  private async ensureSettings(dto: ProvisionTenantDto): Promise<number> {
    const values: Record<string, string> = {
      store_name: dto.name,
      store_email: dto.ownerEmail,
      store_phone: dto.ownerPhone || '',
      currency: 'BDT',
      currency_symbol: '৳',
      delivery_charge: '60',
      free_delivery_min: '1000',
      search_engine_indexing: 'false',
    };
    if (dto.canonicalDomain) {
      values.canonical_domain = dto.canonicalDomain;
      values.storefront_url = dto.canonicalDomain;
    }

    let created = 0;
    for (const [key, value] of Object.entries(values)) {
      const existing = await this.prisma.systemSetting.findFirst({
        where: { key },
        select: { key: true },
      });
      if (existing) continue;
      await this.prisma.systemSetting.upsert({
        where: { tenantId_key: tenantCompound({ key }) },
        update: {},
        create: { key, value },
      });
      created++;
    }
    return created;
  }

  private async ensureWarehouse(): Promise<number> {
    const existing = await this.prisma.warehouse.findFirst({
      where: { slug: 'main-showroom' },
      select: { id: true },
    });
    if (existing) return 0;
    await this.prisma.warehouse.create({
      data: {
        name: 'Main Showroom',
        slug: 'main-showroom',
        type: 'showroom',
        address: 'Main Store Address',
        city: 'Dhaka',
        isActive: true,
      },
    });
    return 1;
  }

  private async ensureStoreLocation(): Promise<number> {
    const existing = await this.prisma.storeLocation.findFirst({
      where: { name: 'Main Store' },
      select: { id: true },
    });
    if (existing) return 0;
    await this.prisma.storeLocation.create({
      data: {
        name: 'Main Store',
        type: 'SHOWROOM',
        address: 'Main Store Address',
        city: 'Dhaka',
        isActive: true,
        sortOrder: 0,
      },
    });
    return 1;
  }

  private async ensureEmailTemplates(): Promise<number> {
    const templates = [
      {
        name: 'Order Confirmation',
        subject: 'Your order {{orderNumber}} is confirmed',
        body:
          '<p>Hi {{customerName}},</p>' +
          '<p>We have received your order {{orderNumber}} for {{orderTotal}}.</p>' +
          '<p>We will let you know as soon as it ships.</p>',
        variables: ['customerName', 'orderNumber', 'orderTotal'],
      },
      {
        name: 'Welcome',
        subject: 'Welcome to {{storeName}}',
        body:
          '<p>Hi {{customerName}},</p>' +
          '<p>Thanks for joining {{storeName}}. Browse the store any time.</p>',
        variables: ['customerName', 'storeName'],
      },
    ];

    let created = 0;
    for (const template of templates) {
      const existing = await this.prisma.emailTemplate.findFirst({
        where: { name: template.name },
        select: { id: true },
      });
      if (existing) continue;
      await this.prisma.emailTemplate.create({ data: template });
      created++;
    }
    return created;
  }

  private async ensurePayment(): Promise<void> {
    for (const option of PAYMENT_OPTIONS) {
      await this.prisma.paymentOption.upsert({
        where: { type: option.type },
        update: {},
        create: {
          type: option.type,
          name: option.name,
          description: option.description,
          enabled: true,
          sortOrder: option.sortOrder,
        },
      });
    }

    const cash = await this.prisma.paymentGateway.findFirst({
      where: { code: 'cash' },
      select: { id: true },
    });
    if (cash) return;

    await this.prisma.paymentGateway.create({
      data: {
        code: 'cash',
        name: 'Cash',
        type: 'cash',
        paymentOptionType: 'CASH_ON_DELIVERY',
        enabled: true,
        mode: 'personal',
        credentials: {},
        sortOrder: 1,
      },
    });
  }
}
