import { TenantMiddleware } from './tenant.middleware';
import { TenantRegistryService } from './tenant-registry.service';
import { getTenantContext } from './tenant-context';

const originalEnv = { ...process.env };

function request(
  host: string,
  extra: Record<string, string> = {},
  remoteAddress = '127.0.0.1',
) {
  return {
    headers: { host, ...extra },
    socket: { remoteAddress },
  };
}

describe('TenantMiddleware host resolution', () => {
  let registry: TenantRegistryService;
  let middleware: TenantMiddleware;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SAAS_PRIMARY_DOMAIN = 'ecomate.bd';
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd';
    process.env.INTERNAL_SHARED_SECRET = 'internal-secret';
    delete process.env.DEFAULT_TENANT_ID;
    registry = new TenantRegistryService();
    registry.replace([
      {
        id: 'tenant-acme',
        slug: 'acme',
        status: 'ACTIVE',
        hosts: ['acme.ecomate.bd'],
      },
      {
        id: 'tenant-other',
        slug: 'other',
        status: 'ACTIVE',
        hosts: ['other.ecomate.bd'],
      },
    ]);
    middleware = new TenantMiddleware(registry);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const resolve = (req: any, res: any = {}) => {
    let context = getTenantContext();
    middleware.use(req, res, () => {
      context = getTenantContext();
    });
    return context;
  };

  it('marks alias hosts noindex on every response path', () => {
    process.env.SAAS_BASE_DOMAINS = 'ecomate.bd,alias.example';
    const res = { header: jest.fn() };
    const context = resolve(request('acme.alias.example'), res);

    expect(context?.tenantId).toBe('tenant-acme');
    expect(context?.isAlias).toBe(true);
    expect(res.header).toHaveBeenCalledWith('X-Robots-Tag', 'noindex');

    const canonicalRes = { header: jest.fn() };
    resolve(request('acme.ecomate.bd'), canonicalRes);
    expect(canonicalRes.header).not.toHaveBeenCalled();
  });

  it('resolves the tenant from the Host header (storefront/admin/POS browsers)', () => {
    expect(resolve(request('acme.ecomate.bd'))?.tenantId).toBe('tenant-acme');
    expect(resolve(request('other.ecomate.bd'))?.tenantId).toBe('tenant-other');
  });

  it('ignores x-tenant-host without the internal secret (no cross-tenant spoofing)', () => {
    const context = resolve(
      request('acme.ecomate.bd', { 'x-tenant-host': 'other.ecomate.bd' }),
    );
    expect(context?.tenantId).toBe('tenant-acme');
  });

  it('ignores x-tenant-host when the secret is wrong', () => {
    const context = resolve(
      request('acme.ecomate.bd', {
        'x-tenant-host': 'other.ecomate.bd',
        'x-internal-secret': 'wrong',
      }),
    );
    expect(context?.tenantId).toBe('tenant-acme');
  });

  it('ignores a valid secret from a public peer (defense in depth)', () => {
    const context = resolve(
      request(
        'acme.ecomate.bd',
        {
          'x-tenant-host': 'other.ecomate.bd',
          'x-internal-secret': 'internal-secret',
        },
        '8.8.8.8',
      ),
    );
    expect(context?.tenantId).toBe('tenant-acme');
  });

  it('honours x-tenant-host for trusted SSR calls from a private peer', () => {
    const context = resolve(
      request('backend:4000', {
        'x-tenant-host': 'other.ecomate.bd',
        'x-internal-secret': 'internal-secret',
      }),
    );
    expect(context?.tenantId).toBe('tenant-other');
  });

  it('never falls back to a default tenant in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEFAULT_TENANT_ID = 'tenant-fallback';
    expect(resolve(request('unknown.example.com'))).toBeUndefined();
  });

  it('resolves hosts under the SYNCED tenant domain, not the env domain', () => {
    // Env still says ecomate.bd, but the platform synced a new tenant
    // domain — resolution must follow the sync, not the env.
    registry.setDomainConfig({
      primaryDomain: 'tenants.example',
      baseDomains: ['tenants.example'],
      customDomainCname: 'cname.tenants.example',
      allowExternalFallback: false,
      platformHosts: {
        landing: 'www.tenants.example',
        platformAdmin: 'saas.app.example.net',
        platformApi: 'api.app.example.net',
        webhooks: 'api.app.example.net',
      },
    });
    const context = resolve(request('acme.tenants.example'));
    expect(context?.tenantId).toBe('tenant-acme');
    expect(context?.canonicalHost).toBe('acme.tenants.example');
    // The old env-domain host no longer resolves as a tenant subdomain
    // (it still matches via the registry host list as a custom host —
    // the row keeps working — but the canonical host is the new one).
    const oldContext = resolve(request('acme.ecomate.bd'));
    expect(oldContext?.tenantId).toBe('tenant-acme');
    expect(oldContext?.canonicalHost).toBe('acme.ecomate.bd');
  });
});
