import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { isIP } from 'net';
import { resolveCname, resolveTxt } from 'node:dns/promises';
import { AuditService } from '../common/audit.service';
import { DomainConfigService } from '../config/domain-config.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { AddDomainDto } from '../tenants/dto/add-domain.dto';

const HOSTNAME_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface DomainDnsInstructions {
  cname: { name: string; value: string };
  txt: { name: string; value: string };
}

export interface DomainCheck {
  ok: boolean;
  expected: string;
  found: string[];
}

export interface DomainVerificationResult {
  verified: boolean;
  domain: any;
  checks: {
    txt: DomainCheck;
    cname: DomainCheck;
  };
  dns: DomainDnsInstructions | null;
}

function normaliseHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

function isInternalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === 'backend' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.invalid') ||
    host.endsWith('.test') ||
    isIP(host) !== 0
  );
}

@Injectable()
export class DomainsService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly domainConfig: DomainConfigService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string) {
    await this.requireTenant(tenantId);
    return this.prisma.tenantDomain.findMany({
      where: { tenantId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async addDomain(tenantId: string, dto: AddDomainDto, actorId?: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        slug: true,
        planVersion: { select: { features: true } },
        subscription: {
          select: { planVersion: { select: { features: true } } },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const host = normaliseHost(dto.host);
    if (!HOSTNAME_RE.test(host) || isInternalHost(host)) {
      throw new BadRequestException('host must be a valid public hostname');
    }

    const config = this.domainConfig.getConfig();
    const resolution = this.domainConfig.resolveHost(host);
    // Existing callers may omit type (the old endpoint defaulted everything to
    // CUSTOM). Infer SUBDOMAIN when the host is this tenant's base-domain host
    // so adding a platform subdomain keeps working.
    const type =
      dto.type ?? (resolution.kind === 'tenant' ? 'SUBDOMAIN' : 'CUSTOM');
    if (type === 'CUSTOM') {
      if (resolution.kind !== 'custom') {
        throw new BadRequestException(
          'Custom domains must be outside the platform base domains',
        );
      }
      if (host === config.customDomainCname) {
        throw new BadRequestException('This host is reserved for the platform');
      }
      this.assertCustomDomainFeature(tenant);
    } else if (
      resolution.kind !== 'tenant' ||
      resolution.slug !== tenant.slug
    ) {
      throw new BadRequestException(
        'Subdomain must be {tenant-slug}.<base domain>',
      );
    }

    const verificationToken =
      type === 'CUSTOM' ? randomBytes(24).toString('hex') : null;

    try {
      const domain = await this.prisma.tenantDomain.create({
        data: {
          tenantId,
          host,
          type: type as any,
          status: 'PENDING',
          verificationToken,
          isPrimary: false,
        },
      });

      await this.audit.record({
        actorId,
        tenantId,
        action: 'tenant.domain.add',
        entity: 'TenantDomain',
        entityId: domain.id,
        after: { host, type },
      });

      return {
        domain,
        dns: verificationToken
          ? this.dnsInstructions(host, verificationToken)
          : null,
      };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException('Domain is already assigned');
      }
      throw err;
    }
  }

  async verify(
    tenantId: string,
    domainId: string,
    actorId?: string,
  ): Promise<DomainVerificationResult> {
    const domain = await this.prisma.tenantDomain.findFirst({
      where: { id: domainId, tenantId },
    });
    if (!domain) throw new NotFoundException('Domain not found');

    if (domain.type !== 'CUSTOM') {
      return {
        verified: true,
        domain,
        checks: {
          txt: { ok: true, expected: '', found: [] },
          cname: { ok: true, expected: '', found: [] },
        },
        dns: null,
      };
    }

    const config = this.domainConfig.getConfig();
    const instructions = this.dnsInstructions(
      domain.host,
      domain.verificationToken,
    );
    if (!instructions || !domain.verificationToken) {
      throw new BadRequestException('This domain has no verification token');
    }

    const [txtFound, cnameFound] = await Promise.all([
      this.resolveTxtRecords(instructions.txt.name),
      this.resolveCnameRecords(domain.host),
    ]);
    const txtOk = txtFound.some(
      (value) => value.trim() === domain.verificationToken,
    );
    const cnameOk = cnameFound.some(
      (value) => normaliseHost(value) === config.customDomainCname,
    );
    const checks = {
      txt: {
        ok: txtOk,
        expected: domain.verificationToken,
        found: txtFound,
      },
      cname: {
        ok: cnameOk,
        expected: config.customDomainCname,
        found: cnameFound,
      },
    };
    const verified = txtOk && cnameOk;

    if (!verified) {
      const pending = await this.prisma.tenantDomain.update({
        where: { id: domain.id },
        data: { lastCheckedAt: new Date() },
      });
      return { verified: false, domain: pending, checks, dns: instructions };
    }

    const now = new Date();
    const [, updated] = await this.prisma.$transaction([
      this.prisma.tenantDomain.updateMany({
        where: { tenantId, id: { not: domain.id } },
        data: { isPrimary: false },
      }),
      this.prisma.tenantDomain.update({
        where: { id: domain.id },
        data: {
          status: 'VERIFIED',
          verifiedAt: now,
          lastCheckedAt: now,
          tlsStatus: 'PENDING',
          isPrimary: true,
        },
      }),
    ]);

    await this.audit.record({
      actorId,
      tenantId,
      action: 'tenant.domain.verify',
      entity: 'TenantDomain',
      entityId: domain.id,
      before: { status: domain.status },
      after: { status: 'VERIFIED', host: domain.host },
    });

    return { verified: true, domain: updated, checks, dns: instructions };
  }

  async remove(tenantId: string, domainId: string, actorId?: string) {
    const domain = await this.prisma.tenantDomain.findFirst({
      where: { id: domainId, tenantId },
    });
    if (!domain) throw new NotFoundException('Domain not found');
    if (domain.type !== 'CUSTOM') {
      throw new BadRequestException('The primary tenant subdomain cannot be removed');
    }

    await this.prisma.tenantDomain.delete({ where: { id: domain.id } });

    if (domain.isPrimary) {
      const subdomain = await this.prisma.tenantDomain.findFirst({
        where: { tenantId, type: 'SUBDOMAIN' },
      });
      if (subdomain) {
        await this.prisma.tenantDomain.update({
          where: { id: subdomain.id },
          data: { isPrimary: true },
        });
      }
    }

    await this.audit.record({
      actorId,
      tenantId,
      action: 'tenant.domain.remove',
      entity: 'TenantDomain',
      entityId: domain.id,
      before: { host: domain.host, type: domain.type },
    });

    return { deleted: true, domainId: domain.id };
  }

  async isTlsHostAllowed(rawHost: string): Promise<boolean> {
    const host = normaliseHost(rawHost);
    if (!host) return false;
    const domain = await this.prisma.tenantDomain.findUnique({
      where: { host },
      select: {
        type: true,
        status: true,
        tenant: { select: { status: true } },
      },
    });
    if (!domain || domain.tenant.status === 'DELETED') return false;
    if (domain.type === 'SUBDOMAIN') return true;
    return domain.status === 'VERIFIED' || domain.status === 'ACTIVE';
  }

  private async requireTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
  }

  private assertCustomDomainFeature(tenant: {
    planVersion?: { features: string[] } | null;
    subscription?: { planVersion?: { features: string[] } | null } | null;
  }) {
    const features =
      tenant.subscription?.planVersion?.features ??
      tenant.planVersion?.features ??
      null;
    // No plan assigned yet: the platform operator may configure domains before
    // a plan is chosen. With a plan, the feature is explicit.
    if (!features) return;
    if (!features.includes('*') && !features.includes('custom_domain')) {
      throw new ForbiddenException(
        'The current plan does not include custom domains',
      );
    }
  }

  private dnsInstructions(
    host: string,
    token: string | null,
  ): DomainDnsInstructions {
    return {
      cname: { name: host, value: this.domainConfig.getConfig().customDomainCname },
      txt: {
        name: `_ecomate-verify.${host}`,
        value: token ?? '',
      },
    };
  }

  private async resolveTxtRecords(name: string): Promise<string[]> {
    try {
      const records = await resolveTxt(name);
      return records.map((chunks) => chunks.join(''));
    } catch {
      return [];
    }
  }

  private async resolveCnameRecords(name: string): Promise<string[]> {
    try {
      return await resolveCname(name);
    } catch {
      return [];
    }
  }
}
