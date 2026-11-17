import { RequestIdMiddleware } from './request-id.middleware';
import { getRequestId } from './request-context';

describe('RequestIdMiddleware', () => {
  const middleware = new RequestIdMiddleware();

  function run(req: any) {
    const headers: Record<string, string> = {};
    const res = { setHeader: jest.fn((k: string, v: string) => { headers[k] = v; }) } as any;
    let seen: string | undefined;
    middleware.use(req, res, () => {
      seen = getRequestId();
    });
    return { headers, seen };
  }

  it('reuses req.id set by pino-http (one id per request)', () => {
    const { headers, seen } = run({
      id: 'pino-id-1',
      headers: {},
    });
    expect(seen).toBe('pino-id-1');
    expect(headers['x-request-id']).toBe('pino-id-1');
  });

  it('honours the x-request-id header', () => {
    const { headers, seen } = run({
      headers: { 'x-request-id': 'client-1' },
    });
    expect(seen).toBe('client-1');
    expect(headers['x-request-id']).toBe('client-1');
  });

  it('falls back to x-correlation-id, then generates a UUID', () => {
    const viaCorrelation = run({
      headers: { 'x-correlation-id': 'corr-1' },
    });
    expect(viaCorrelation.seen).toBe('corr-1');
    const generated = run({ headers: {} });
    expect(generated.seen).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(generated.headers['x-request-id']).toBe(generated.seen);
  });

  it('stashes the id on the request for the onResponse access log', () => {
    const req: any = { headers: { 'x-request-id': 'stash-1' } };
    run(req);
    expect(req.requestId).toBe('stash-1');
  });
});
