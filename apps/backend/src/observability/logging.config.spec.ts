import { correlationIdStorage } from '../common/middleware/correlation-id.middleware';
import { runWithTenant, tenantStorage } from '../tenancy/tenant-context';
import {
  LOG_REDACT_PATHS,
  buildPinoHttpOptions,
  logLevel,
  logMixin,
} from './logging.config';

describe('logMixin (tenant-tagged logging)', () => {
  it('always tags the service', () => {
    expect(logMixin()).toEqual({ service: 'backend' });
  });

  it('adds tenantId from the tenant ALS context', () => {
    runWithTenant(
      { tenantId: 'tenant-1', slug: 'shop-1' },
      () => {
        expect(logMixin()).toEqual({
          service: 'backend',
          tenantId: 'tenant-1',
        });
      },
    );
  });

  it('adds requestId from the correlation-id ALS context', () => {
    correlationIdStorage.run('req-123', () => {
      expect(logMixin()).toEqual({
        service: 'backend',
        requestId: 'req-123',
      });
    });
  });

  it('carries both ids when both contexts are present', () => {
    runWithTenant({ tenantId: 'tenant-9', slug: 'shop-9' }, () => {
      correlationIdStorage.run('req-9', () => {
        expect(logMixin()).toEqual({
          service: 'backend',
          tenantId: 'tenant-9',
          requestId: 'req-9',
        });
      });
    });
  });

  it('omits the fields (no nulls) outside any request', () => {
    expect(tenantStorage.getStore()).toBeUndefined();
    expect(correlationIdStorage.getStore()).toBeUndefined();
    expect(logMixin()).toEqual({ service: 'backend' });
  });
});

describe('logLevel', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('honours LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'debug';
    expect(logLevel()).toBe('debug');
  });

  it('is silent under jest (NODE_ENV=test) unless LOG_LEVEL is set', () => {
    delete process.env.LOG_LEVEL;
    process.env.NODE_ENV = 'test';
    expect(logLevel()).toBe('silent');
  });

  it('defaults to info outside tests', () => {
    delete process.env.LOG_LEVEL;
    process.env.NODE_ENV = 'production';
    expect(logLevel()).toBe('info');
  });
});

describe('buildPinoHttpOptions', () => {
  it('disables pino-http auto-logging (the onResponse hook owns access logs)', () => {
    const options = buildPinoHttpOptions() as Record<string, unknown>;
    expect(options.autoLogging).toBe(false);
  });

  it('redacts secrets', () => {
    expect(LOG_REDACT_PATHS).toContain('password');
    expect(LOG_REDACT_PATHS).toContain('accessToken');
    expect(LOG_REDACT_PATHS).toContain('req.headers.authorization');
    const options = buildPinoHttpOptions() as Record<string, unknown>;
    const redact = options.redact as { paths: string[]; censor: string };
    expect(redact.paths).toEqual(LOG_REDACT_PATHS);
    expect(redact.censor).toBe('[REDACTED]');
  });

  it('genReqId honours x-request-id, then x-correlation-id, then generates', () => {
    const options = buildPinoHttpOptions() as {
      genReqId: (req: { headers: Record<string, string> }) => string;
    };
    expect(
      options.genReqId({ headers: { 'x-request-id': 'a' } }),
    ).toBe('a');
    expect(
      options.genReqId({ headers: { 'x-correlation-id': 'b' } }),
    ).toBe('b');
    expect(options.genReqId({ headers: {} })).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
