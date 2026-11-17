import {
  TlsHealthService,
  classifyTlsStatus,
} from './tls-health.service';
import type { TlsProbeResult } from './tls-prober';

function probe(overrides: Partial<TlsProbeResult>): TlsProbeResult {
  return {
    tlsOk: true,
    expiryDays: 60,
    expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
    subjectCn: 'shop.example.com',
    tlsError: null,
    reachable: true,
    httpStatus: 200,
    httpError: null,
    ok: true,
    ...overrides,
  };
}

describe('classifyTlsStatus', () => {
  it('ACTIVE when TLS is valid, reachable, and far from expiry', () => {
    expect(classifyTlsStatus(probe({}), 14)).toBe('ACTIVE');
  });

  it('EXPIRING_SOON inside the alert window', () => {
    expect(classifyTlsStatus(probe({ expiryDays: 13 }), 14)).toBe(
      'EXPIRING_SOON',
    );
    expect(classifyTlsStatus(probe({ expiryDays: 0 }), 14)).toBe(
      'EXPIRING_SOON',
    );
  });

  it('ACTIVE exactly at the alert boundary', () => {
    expect(classifyTlsStatus(probe({ expiryDays: 14 }), 14)).toBe('ACTIVE');
  });

  it('EXPIRED when the cert is past not-after (even with a chain error)', () => {
    expect(
      classifyTlsStatus(
        probe({ expiryDays: -1, tlsOk: false, tlsError: 'expired', ok: false }),
        14,
      ),
    ).toBe('EXPIRED');
  });

  it('UNREACHABLE when TLS fails', () => {
    expect(
      classifyTlsStatus(
        probe({
          tlsOk: false,
          tlsError: 'self-signed certificate',
          ok: false,
        }),
        14,
      ),
    ).toBe('UNREACHABLE');
  });

  it('UNREACHABLE when the host does not answer HTTP', () => {
    expect(
      classifyTlsStatus(
        probe({
          reachable: false,
          httpStatus: null,
          httpError: 'timeout',
          ok: false,
        }),
        14,
      ),
    ).toBe('UNREACHABLE');
  });

  it('UNREACHABLE when no certificate was seen at all', () => {
    expect(
      classifyTlsStatus(
        probe({
          tlsOk: false,
          expiryDays: null,
          expiresAt: null,
          tlsError: 'ECONNREFUSED',
          reachable: false,
          httpStatus: null,
          httpError: 'ECONNREFUSED',
          ok: false,
        }),
        14,
      ),
    ).toBe('UNREACHABLE');
  });
});

describe('TlsHealthService.runProbe', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.TLS_PRIMARY_PROBE_ENABLED;
    process.env.NODE_ENV = 'test';
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  function setup(
    domains: Array<{ id: string; host: string; tlsStatus: string | null }>,
    probes: Record<string, TlsProbeResult>,
  ) {
    const prisma = {
      tenantDomain: {
        findMany: jest.fn().mockResolvedValue(domains),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const domainConfigState: { probe: boolean | null } = { probe: null };
    const domainConfig = {
      getConfig: () => ({ primaryDomain: 'ecomate.bd' }),
      getPrimaryProbeResult: jest.fn(() => domainConfigState.probe),
      setPrimaryProbeResult: jest.fn((healthy: boolean) => {
        domainConfigState.probe = healthy;
      }),
    } as any;
    const alerts = {
      sendAlert: jest.fn().mockResolvedValue({ sent: true }),
    } as any;
    const metrics = {
      recordTlsProbe: jest.fn(),
      recordPrimaryHealth: jest.fn(),
    } as any;
    const prober = {
      probe: jest.fn(async (host: string) => {
        const result = probes[host];
        if (!result) throw new Error(`no probe fixture for ${host}`);
        return result;
      }),
    } as any;
    const service = new TlsHealthService(
      prisma,
      domainConfig,
      alerts,
      metrics,
      prober,
    );
    return { prisma, domainConfig, alerts, metrics, prober, service };
  }

  it('transitions PENDING -> ACTIVE and records metrics, no alert', async () => {
    const { prisma, alerts, metrics, service } = setup(
      [{ id: 'd1', host: 'shop.example.com', tlsStatus: 'PENDING' }],
      { 'shop.example.com': probe({}) },
    );
    const result = await service.runProbe();
    expect(result.domainsChecked).toBe(1);
    expect(result.transitions).toEqual([
      { host: 'shop.example.com', from: 'PENDING', to: 'ACTIVE' },
    ]);
    expect(prisma.tenantDomain.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { tlsStatus: 'ACTIVE', lastCheckedAt: expect.any(Date) },
    });
    expect(metrics.recordTlsProbe).toHaveBeenCalledWith(
      'shop.example.com',
      true,
      60,
    );
    expect(alerts.sendAlert).not.toHaveBeenCalled();
  });

  it('alerts on transition into EXPIRING_SOON (per-domain kind)', async () => {
    const { alerts, service } = setup(
      [{ id: 'd1', host: 'shop.example.com', tlsStatus: 'ACTIVE' }],
      { 'shop.example.com': probe({ expiryDays: 10 }) },
    );
    const result = await service.runProbe();
    expect(result.transitions).toEqual([
      { host: 'shop.example.com', from: 'ACTIVE', to: 'EXPIRING_SOON' },
    ]);
    expect(alerts.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tls-shop.example.com',
        subject: expect.stringContaining('expires in 10 day(s)'),
      }),
    );
    expect(result.alertsSent).toBe(1);
  });

  it('does NOT re-alert when the status is unchanged', async () => {
    const { alerts, prisma, service } = setup(
      [{ id: 'd1', host: 'shop.example.com', tlsStatus: 'EXPIRED' }],
      { 'shop.example.com': probe({ expiryDays: -2, tlsOk: false, ok: false }) },
    );
    const result = await service.runProbe();
    expect(result.transitions).toEqual([]);
    expect(alerts.sendAlert).not.toHaveBeenCalled();
    // lastCheckedAt is still refreshed on an unchanged probe.
    expect(prisma.tenantDomain.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { lastCheckedAt: expect.any(Date) },
    });
  });

  it('alerts on transition into UNREACHABLE', async () => {
    const { alerts, service } = setup(
      [{ id: 'd1', host: 'shop.example.com', tlsStatus: 'ACTIVE' }],
      {
        'shop.example.com': probe({
          tlsOk: false,
          expiryDays: null,
          expiresAt: null,
          tlsError: 'ECONNREFUSED',
          reachable: false,
          httpStatus: null,
          httpError: 'ECONNREFUSED',
          ok: false,
        }),
      },
    );
    await service.runProbe();
    expect(alerts.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tls-shop.example.com',
        subject: expect.stringContaining('UNREACHABLE'),
      }),
    );
  });

  it('keeps probing other domains when one probe throws', async () => {
    const { service } = setup(
      [
        { id: 'd1', host: 'bad.example.com', tlsStatus: 'PENDING' },
        { id: 'd2', host: 'good.example.com', tlsStatus: 'PENDING' },
      ],
      { 'good.example.com': probe({}) },
    );
    const result = await service.runProbe();
    expect(result.domainsChecked).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('bad.example.com');
    expect(result.transitions).toEqual([
      { host: 'good.example.com', from: 'PENDING', to: 'ACTIVE' },
    ]);
  });

  it('does not probe the primary domain in test env by default', async () => {
    const { prober, service } = setup([], {});
    const result = await service.runProbe();
    expect(result.primaryProbed).toBe(false);
    expect(prober.probe).not.toHaveBeenCalled();
  });

  it('primary probe: needs 2 consecutive failures to flip unhealthy', async () => {
    process.env.TLS_PRIMARY_PROBE_ENABLED = 'true';
    const failing = probe({
      tlsOk: false,
      tlsError: 'timeout',
      reachable: false,
      httpStatus: null,
      httpError: 'timeout',
      ok: false,
    });
    const { domainConfig, alerts, service } = setup([], {
      'ecomate.bd': failing,
    });
    // First failure: no flip (hysteresis), no alert.
    const first = await service.runProbe();
    expect(first.primaryProbed).toBe(true);
    expect(first.primaryHealthy).toBeNull();
    expect(domainConfig.setPrimaryProbeResult).not.toHaveBeenCalled();
    expect(alerts.sendAlert).not.toHaveBeenCalled();
    // Second consecutive failure: flip + alert.
    const second = await service.runProbe();
    expect(second.primaryHealthy).toBe(false);
    expect(domainConfig.setPrimaryProbeResult).toHaveBeenCalledWith(false);
    expect(alerts.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'primary-domain-unhealthy' }),
    );
  });

  it('primary probe: one success recovers immediately', async () => {
    process.env.TLS_PRIMARY_PROBE_ENABLED = 'true';
    let primaryProbe = probe({
      tlsOk: false,
      tlsError: 'timeout',
      reachable: false,
      httpStatus: null,
      httpError: 'timeout',
      ok: false,
    });
    const { domainConfig, service } = setup([], {});
    (service as any).prober = {
      probe: jest.fn(async () => primaryProbe),
    };
    await service.runProbe();
    await service.runProbe();
    expect(domainConfig.setPrimaryProbeResult).toHaveBeenCalledWith(false);
    // Now healthy: single success flips back.
    primaryProbe = probe({});
    const recovered = await service.runProbe();
    expect(recovered.primaryHealthy).toBe(true);
    expect(domainConfig.setPrimaryProbeResult).toHaveBeenCalledWith(true);
  });

  it('honours TLS_EXPIRY_ALERT_DAYS', async () => {
    process.env.TLS_EXPIRY_ALERT_DAYS = '30';
    const { service } = setup(
      [{ id: 'd1', host: 'shop.example.com', tlsStatus: 'ACTIVE' }],
      { 'shop.example.com': probe({ expiryDays: 20 }) },
    );
    const result = await service.runProbe();
    expect(result.transitions).toEqual([
      { host: 'shop.example.com', from: 'ACTIVE', to: 'EXPIRING_SOON' },
    ]);
  });
});
