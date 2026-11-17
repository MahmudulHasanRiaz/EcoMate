import { of, throwError } from 'rxjs';
import { HttpMetricsInterceptor, routePattern } from './metrics.interceptor';

describe('routePattern', () => {
  it('prefers the Fastify v5 routeOptions pattern', () => {
    expect(
      routePattern({ routeOptions: { url: '/api/tenants/:id' } }),
    ).toBe('/api/tenants/:id');
  });

  it('collapses unmatched requests instead of leaking raw paths', () => {
    expect(routePattern({ raw: { url: '/api/tenants/secret-id' } })).toBe(
      'unmatched',
    );
    expect(routePattern({})).toBe('unmatched');
  });
});

function contextFor(request: any, reply: any) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply,
    }),
  } as any;
}

describe('HttpMetricsInterceptor', () => {
  it('observes method/route/status/duration on success', (done) => {
    const metrics = { observeHttp: jest.fn() };
    const interceptor = new HttpMetricsInterceptor(metrics as any);
    const ctx = contextFor(
      {
        method: 'GET',
        raw: { url: '/api/tenants/abc' },
        routeOptions: { url: '/api/tenants/:id' },
      },
      { statusCode: 200 },
    );
    interceptor
      .intercept(ctx, { handle: () => of({ ok: true }) } as any)
      .subscribe({
        complete: () => {
          expect(metrics.observeHttp).toHaveBeenCalledTimes(1);
          const [method, route, status, seconds] =
            metrics.observeHttp.mock.calls[0];
          expect(method).toBe('GET');
          expect(route).toBe('/api/tenants/:id');
          expect(status).toBe(200);
          expect(seconds).toBeGreaterThanOrEqual(0);
          done();
        },
      });
  });

  it('observes the exception status on error', (done) => {
    const metrics = { observeHttp: jest.fn() };
    const interceptor = new HttpMetricsInterceptor(metrics as any);
    const ctx = contextFor(
      { method: 'POST', raw: { url: '/api/jobs/x/run' } },
      { statusCode: 200 },
    );
    const error = Object.assign(new Error('nope'), { status: 404 });
    interceptor
      .intercept(ctx, { handle: () => throwError(() => error) } as any)
      .subscribe({
        error: () => {
          expect(metrics.observeHttp).toHaveBeenCalledWith(
            'POST',
            'unmatched',
            404,
            expect.any(Number),
          );
          done();
        },
      });
  });

  it('never meters the /metrics scrape itself', (done) => {
    const metrics = { observeHttp: jest.fn() };
    const interceptor = new HttpMetricsInterceptor(metrics as any);
    const ctx = contextFor(
      { method: 'GET', raw: { url: '/metrics' } },
      { statusCode: 200 },
    );
    interceptor
      .intercept(ctx, { handle: () => of('...') } as any)
      .subscribe({
        complete: () => {
          expect(metrics.observeHttp).not.toHaveBeenCalled();
          done();
        },
      });
  });
});
