import {
  LOG_REDACT_PATHS,
  buildPinoHttpOptions,
  logLevel,
  logMixin,
} from './logging.config';
import { getRequestId, runWithRequestId } from './request-context';

describe('logMixin (request-tagged logging)', () => {
  it('always tags the service', () => {
    expect(logMixin()).toEqual({ service: 'platform-api' });
  });

  it('adds requestId from the request ALS context', () => {
    runWithRequestId('req-42', () => {
      expect(getRequestId()).toBe('req-42');
      expect(logMixin()).toEqual({
        service: 'platform-api',
        requestId: 'req-42',
      });
    });
  });

  it('omits requestId outside any request', () => {
    expect(getRequestId()).toBeUndefined();
    expect(logMixin()).toEqual({ service: 'platform-api' });
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

  it('redacts platform secrets', () => {
    expect(LOG_REDACT_PATHS).toContain('mfaSecret');
    expect(LOG_REDACT_PATHS).toContain('inviteToken');
    expect(LOG_REDACT_PATHS).toContain('tempPassword');
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
    expect(options.genReqId({ headers: { 'x-request-id': 'a' } })).toBe('a');
    expect(
      options.genReqId({ headers: { 'x-correlation-id': 'b' } }),
    ).toBe('b');
    expect(options.genReqId({ headers: {} })).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
