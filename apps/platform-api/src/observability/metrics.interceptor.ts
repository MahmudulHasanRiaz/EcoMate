import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

/**
 * Resolve the matched route pattern for the `route` metric label. The raw
 * path would explode cardinality (ids in the URL), so anything unmatched
 * collapses to 'unmatched' instead of the literal path.
 */
export function routePattern(request: {
  routeOptions?: { url?: string };
  routeConfig?: { url?: string };
  raw?: { url?: string };
}): string {
  const pattern =
    request.routeOptions?.url ?? request.routeConfig?.url ?? null;
  if (pattern) return pattern;
  return 'unmatched';
}

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<{
      method: string;
      raw?: { url?: string };
      routeOptions?: { url?: string };
      routeConfig?: { url?: string };
    }>();
    const reply = http.getResponse<{ statusCode?: number }>();
    // Never meter the scrape itself.
    if (request.raw?.url === '/metrics' || request.raw?.url?.startsWith('/metrics?')) {
      return next.handle();
    }
    const method = request.method ?? 'UNKNOWN';
    const started = process.hrtime.bigint();
    const observe = (statusCode: number) => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      this.metrics.observeHttp(
        method,
        routePattern(request),
        statusCode,
        seconds,
      );
    };
    return next.handle().pipe(
      tap({
        next: () => observe(reply.statusCode ?? 200),
        error: (error: { status?: number }) =>
          observe(
            typeof error?.status === 'number' ? error.status : 500,
          ),
      }),
    );
  }
}
