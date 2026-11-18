import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { Logger as PinoLoggerService, PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { initSentry } from './observability/sentry';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // disableRequestLogging: Fastify's own per-request lines are untagged
    // JSON; the onResponse hook below emits the single structured access
    // log (requestId) instead.
    // genReqId: Fastify assigns request.id BEFORE pino-http runs, and
    // pino-http only calls its own genReqId when req.id is unset — so the
    // header-derived id must be assigned HERE, or every request logs as
    // req-N. Same rule as RequestIdMiddleware (x-request-id, then
    // x-correlation-id, then a fresh UUID) so req.id, req.log bindings,
    // and the access log agree on one id.
    new FastifyAdapter({
      trustProxy: true,
      disableRequestLogging: true,
      genReqId: (req) =>
        (req.headers['x-request-id'] as string) ||
        (req.headers['x-correlation-id'] as string) ||
        randomUUID(),
    }),
  );

  // Phase 8 Stage 2 item 19: JSON logs for every `new Logger()` call site.
  app.useLogger(app.get(PinoLoggerService));
  // Phase 8 Stage 2 item 20: Sentry is inert without a real SENTRY_DSN.
  initSentry('platform-api');

  // Security headers (defence in depth for direct exposure; the console
  // and landing reach the API same-origin, so the defaults are safe).
  await app.register(helmet);

  // Multipart uploads (media library only). The fileSize cap mirrors
  // MEDIA_MAX_BYTES (default 100 MB, see media-validation.ts); the
  // media service re-checks the size itself with the friendly error.
  const mediaMaxBytes = Number(process.env.MEDIA_MAX_BYTES ?? '');
  await app.register(multipart, {
    limits: {
      fileSize:
        Number.isFinite(mediaMaxBytes) && mediaMaxBytes > 0
          ? Math.floor(mediaMaxBytes)
          : 100 * 1024 * 1024,
    },
  });

  // /metrics is root-level (outside /api) so it never collides with the
  // business metrics at /api/metrics/overview; see MetricsController.
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'metrics', method: RequestMethod.GET }],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Structured access log (Phase 8 Stage 2 item 19). This hook runs
  // outside the middleware ALS scope, so the request id is read off the
  // raw request (stashed by RequestIdMiddleware) / response header.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onResponse', async (request, reply) => {
      const durationMs = Number(reply.elapsedTime.toFixed(0));
      const requestPath = request.url.split(/[?#]/, 1)[0];
      const requestId =
        (request.raw as { requestId?: string }).requestId ||
        reply.getHeader('x-request-id') ||
        String(request.id);
      const rootLogger = PinoLogger.root;
      if (rootLogger) {
        rootLogger.info(
          {
            service: 'platform-api',
            requestId: String(requestId),
            method: request.method,
            path: requestPath,
            statusCode: reply.statusCode,
            durationMs,
          },
          'request completed',
        );
      } else {
        console.log(
          `${request.method} ${requestPath} ${reply.statusCode} ${durationMs}ms`,
        );
      }
    });

  // The platform admin and landing origins are added with those apps.
  // Platform endpoints are same-origin or server-to-server until then.

  const port = Number(process.env.PLATFORM_PORT ?? 4100);
  await app.listen(port, '0.0.0.0');
  console.log(`Platform API listening on http://0.0.0.0:${port}/api`);
}

void bootstrap();
