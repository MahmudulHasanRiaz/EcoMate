import { HealthController } from './health.controller';

function makeController(primaryHealthy = true, fallbackDomain?: string) {
  const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
  const domainConfig = {
    getConfig: () => ({
      primaryDomain: 'ecomate.bd',
      baseDomains: ['ecomate.bd', 'alias.example'],
      fallbackDomain,
      customDomainCname: 'cname.ecomate.bd',
      allowExternalFallback: false,
      primaryHealthy,
      platformHosts: {
        landing: 'www.ecomate.bd',
        platformAdmin: 'saas.ecomate.bd',
        platformApi: 'api.ecomate.bd',
        webhooks: 'api.ecomate.bd',
      },
    }),
    isPrimaryHealthy: () => primaryHealthy,
    getPrimaryProbeResult: () => null,
    effectiveBaseDomain: () =>
      !primaryHealthy && fallbackDomain ? fallbackDomain : 'ecomate.bd',
  };
  return {
    prisma,
    domainConfig,
    controller: new HealthController(prisma as any, domainConfig as any),
  };
}

describe('Platform health — domain status', () => {
  it('reports the domain config and the healthy primary', async () => {
    const { controller } = makeController(true);

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.domains).toMatchObject({
      primaryDomain: 'ecomate.bd',
      baseDomains: ['ecomate.bd', 'alias.example'],
      fallbackDomain: null,
      primaryHealthy: true,
      effectiveBaseDomain: 'ecomate.bd',
    });
  });

  it('degrades when the primary is unhealthy and no fallback exists', async () => {
    const { controller } = makeController(false);
    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.domains.effectiveBaseDomain).toBe('ecomate.bd');
  });

  it('stays ok during a primary outage when a fallback is configured', async () => {
    const { controller } = makeController(false, 'alias.example');
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.domains).toMatchObject({
      primaryHealthy: false,
      fallbackDomain: 'alias.example',
      effectiveBaseDomain: 'alias.example',
    });
  });
});
