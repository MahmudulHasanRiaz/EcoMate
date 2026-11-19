import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { DomainConfigService } from '../config/domain-config.service';
import { InternalServiceGuard } from '../internal/internal-service.guard';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { AddDomainDto } from '../tenants/dto/add-domain.dto';
import {
  DomainDnsInstructions,
  DomainsService,
} from './domains.service';

/** A TenantDomain row as the tenant backend may see it — no token field. */
export interface TenantDomainView {
  id: string;
  host: string;
  type: string;
  isPrimary: boolean;
  status: string;
  tlsStatus: string | null;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
  /** DNS setup instructions, only while a custom domain needs setup. */
  dns: DomainDnsInstructions | null;
}

type TenantDomainRow = {
  id: string;
  host: string;
  type: string;
  isPrimary: boolean;
  verificationToken: string | null;
  status: string;
  tlsStatus: string | null;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
};

/**
 * Tenant self-service domain operations for the tenant backend.
 * Service-token guarded like the other /internal endpoints — the backend
 * is the caller, never the browser.
 *
 * Tenant scoping: every route takes the tenant id from the path, and the
 * domain rows are verified to belong to that tenant before acting
 * (DomainsService.recheck looks a domain up by id alone, so the
 * recheck route scopes it here first — a tenant must never learn
 * another tenant's verification result).
 *
 * The verification token itself is never returned as a field. It only
 * appears as the TXT record value inside the DNS instructions the
 * tenant must publish — that is its purpose. Recheck responses carry
 * only the per-check ok flags for TXT (the token is the expected
 * value); the CNAME expectation is public DNS data and is kept.
 */
@Controller('internal/tenants/:tenantId/domains')
@UseGuards(InternalServiceGuard)
export class InternalDomainsController {
  constructor(
    private readonly domains: DomainsService,
    private readonly domainConfig: DomainConfigService,
    private readonly prisma: PlatformPrismaService,
  ) {}

  @Get()
  async list(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<TenantDomainView[]> {
    const rows = await this.domains.list(tenantId);
    return rows.map((row) => this.toView(row));
  }

  @Post()
  async add(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: AddDomainDto,
  ): Promise<{ domain: TenantDomainView; dns: DomainDnsInstructions | null }> {
    // Tenants manage CUSTOM domains only — the platform subdomain is
    // assigned at provisioning. Forcing CUSTOM makes addDomain reject
    // platform-subdomain hosts (400) and run the custom-domain feature
    // gate (403 without the `custom_domain` plan feature).
    const { domain, dns } = await this.domains.addDomain(tenantId, {
      ...dto,
      type: 'CUSTOM',
    });
    return { domain: this.toView(domain), dns };
  }

  @Post(':domainId/recheck')
  @HttpCode(200)
  async recheck(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ) {
    const owned = await this.prisma.tenantDomain.findFirst({
      where: { id: domainId, tenantId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Domain not found');
    const result = await this.domains.recheck(domainId);
    return {
      verified: result.verified,
      domain: this.toView(result.domain),
      checks: {
        txt: { ok: result.checks.txt.ok },
        cname: {
          ok: result.checks.cname.ok,
          expected: result.checks.cname.expected,
          found: result.checks.cname.found,
        },
      },
      dns: result.dns,
    };
  }

  @Delete(':domainId')
  async remove(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ) {
    return this.domains.remove(tenantId, domainId);
  }

  private toView(row: TenantDomainRow): TenantDomainView {
    return {
      id: row.id,
      host: row.host,
      type: row.type,
      isPrimary: row.isPrimary,
      status: row.status,
      tlsStatus: row.tlsStatus,
      verifiedAt: row.verifiedAt,
      lastCheckedAt: row.lastCheckedAt,
      createdAt: row.createdAt,
      dns:
        row.type === 'CUSTOM' &&
        (row.status === 'PENDING' || row.status === 'FAILED')
          ? this.dnsInstructions(row.host, row.verificationToken)
          : null,
    };
  }

  /**
   * Mirror of DomainsService.dnsInstructions (private there): the CNAME
   * target comes from the live domain config and the TXT record carries
   * the verification token. Keep the `_ecomate-verify.` prefix in sync
   * with domains.service.ts — it is the name verify() looks up.
   */
  private dnsInstructions(
    host: string,
    token: string | null,
  ): DomainDnsInstructions {
    return {
      cname: {
        name: host,
        value: this.domainConfig.getConfig().customDomainCname,
      },
      txt: {
        name: `_ecomate-verify.${host}`,
        value: token ?? '',
      },
    };
  }
}
