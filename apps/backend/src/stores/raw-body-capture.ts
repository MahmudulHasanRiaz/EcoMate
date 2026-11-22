/**
 * Route-scoped raw-body capture — P0 proof artifact for §8.7.
 *
 * Captures the raw request buffer ONLY for `/api/webhooks/stores/*`
 * (future WooCommerce / Shopify / Custom bridge receivers). Every other
 * URL exits on a prefix check with no buffering and no stream wrapping,
 * so the default JSON parser — and every other endpoint — behaves
 * identically. Registered through the same `HttpAdapterHost` mechanism
 * as the `CsvBodyParser` precedent (no `main.ts` changes).
 *
 * Rejected alternatives: global `rawBody: true`, replacing the global
 * `application/json` parser (both alter every endpoint).
 */
import { Readable } from 'node:stream';
import { PayloadTooLargeException } from '@nestjs/common';
import { STORE_WEBHOOK_MAX_BODY_BYTES_DEFAULT } from './store-flags';

export const STORE_WEBHOOK_PREFIX = '/api/webhooks/stores/';

/**
 * The 413 for an oversized webhook body. Thrown from a Fastify preParsing
 * hook, so it must survive TWO error handlers: Nest's exception filter
 * only honours HttpException (via getStatus()), while raw Fastify only
 * honours err.statusCode — the error carries both. Live find 2026-11-22:
 * a plain Error with statusCode came back 500 under Nest ("Unhandled
 * Exception"), even though the P0 proof (raw Fastify) asserted 413.
 */
export function payloadTooLargeError(): Error {
  const err = new PayloadTooLargeException('Payload too large');
  (err as unknown as { statusCode: number }).statusCode = 413;
  return err;
}

export function isStoreWebhookPath(url: string): boolean {
  const pathname = url.split('?', 1)[0];
  return pathname.startsWith(STORE_WEBHOOK_PREFIX);
}

export interface RawBodyCaptureOptions {
  maxBytes?: number;
}

/**
 * Register the route-scoped `preParsing` hook on a Fastify instance.
 * Non-matching URLs return the untouched stream. Matching URLs are
 * buffered (hard-capped → 413), the buffer is stored as
 * `(request as any).rawBody`, and a fresh stream over the same bytes is
 * returned so the default JSON parser behaves identically.
 */
export function registerStoreWebhookRawBodyCapture(
  instance: {
    addHook: (
      name: 'preParsing',
      handler: (request: any, reply: any, payload: any) => Promise<any>,
    ) => void;
  },
  opts: RawBodyCaptureOptions = {},
): void {
  const maxBytes = opts.maxBytes ?? STORE_WEBHOOK_MAX_BODY_BYTES_DEFAULT;
  instance.addHook('preParsing', async (request: any, reply: any, payload: any) => {
    if (!isStoreWebhookPath(request.url ?? '')) return payload;

    const fastLength = Number(request.headers?.['content-length'] ?? 0);
    if (Number.isFinite(fastLength) && fastLength > maxBytes) {
      throw payloadTooLargeError();
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of payload as AsyncIterable<Buffer>) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        throw payloadTooLargeError();
      }
      chunks.push(buf);
    }
    const raw = Buffer.concat(chunks);
    request.rawBody = raw;
    return Readable.from(raw);
  });
}
