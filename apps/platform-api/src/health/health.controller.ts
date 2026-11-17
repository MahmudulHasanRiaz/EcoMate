import { Controller, Get } from '@nestjs/common';
import { DomainConfigService } from '../config/domain-config.service';
import { PlatformPrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly domainConfig: DomainConfigService,
  ) {}

  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    const domains = this.domainConfig.getConfig();
    // The API stays usable during a primary-domain outage as long as a
    // fallback is configured; without one the domain layer is degraded.
    const degraded = !this.domainConfig.isPrimaryHealthy() && !domains.fallbackDomain;
    return {
      status: degraded ? 'degraded' : 'ok',
      service: 'platform-api',
      timestamp: new Date().toISOString(),
      domains: {
        primaryDomain: domains.primaryDomain,
        baseDomains: domains.baseDomains,
        fallbackDomain: domains.fallbackDomain ?? null,
        allowExternalFallback: domains.allowExternalFallback,
        primaryHealthy: this.domainConfig.isPrimaryHealthy(),
        primaryProbe: this.domainConfig.getPrimaryProbeResult(),
        effectiveBaseDomain: this.domainConfig.effectiveBaseDomain(),
        customDomainCname: domains.customDomainCname,
        platformHosts: domains.platformHosts,
      },
    };
  }
}
