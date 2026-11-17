import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runWithRequestId } from './request-context';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(
    req: IncomingMessage & { id?: unknown; requestId?: string },
    res: ServerResponse,
    next: () => void,
  ): void {
    // Fastify assigns req.id at the edge (main.ts genReqId, header-derived),
    // before pino-http and before this middleware — reuse it so there is
    // exactly one request id per request, not two. The header fallbacks
    // cover non-Fastify callers (tests, direct handler use).
    const requestId =
      (typeof req.id === 'string' && req.id) ||
      (req.headers['x-request-id'] as string) ||
      (req.headers['x-correlation-id'] as string) ||
      randomUUID();
    req.requestId = requestId;
    runWithRequestId(requestId, () => {
      res.setHeader('x-request-id', requestId);
      next();
    });
  }
}
