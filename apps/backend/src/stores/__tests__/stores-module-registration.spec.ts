/**
 * Phase 9 webhook fix — StoresModule registration regression guard
 * (coordinator decision 2026-11-23, B4's blocker; workstream D owns
 * stores.module.ts).
 *
 * `WebhookFailuresService` + `WebhookFailuresController` (Builder B)
 * MUST be registered in StoresModule: without the provider, the two
 * `@Optional()` injection sites (webhook intake, ingest processor)
 * resolve `undefined` and NO failure rows record anywhere; without
 * the controller, the replay/list endpoints 404.
 *
 * This suite asserts registration + route metadata WITHOUT booting
 * the module (no Redis/DB): Nest stores the @Module metadata on the
 * class, and the controller's route decorators store path/method
 * metadata on the class and its methods. If either class is ever
 * dropped from the module (or a route renamed), this fails loudly.
 */
import 'reflect-metadata';
import { StoresModule } from '../stores.module';
import { WebhookFailuresService } from '../webhooks/webhook-failures.service';
import { WebhookFailuresController } from '../webhooks/webhook-failures.controller';
import { StoreWebhookHealthService } from '../webhooks/store-webhook-health.service';
import { StoreWebhookHealthController } from '../webhooks/store-webhook-health.controller';

function moduleMeta(key: string): unknown[] {
  return (Reflect.getMetadata(key, StoresModule) as unknown[]) ?? [];
}

describe('StoresModule webhook-failure registration (G-12/G-16)', () => {
  it('registers WebhookFailuresService as a provider (and exports it)', () => {
    expect(moduleMeta('providers')).toContain(WebhookFailuresService);
    expect(moduleMeta('exports')).toContain(WebhookFailuresService);
  });

  it('registers WebhookFailuresController as a controller', () => {
    expect(moduleMeta('controllers')).toContain(WebhookFailuresController);
  });

  it('keeps the webhook-health pair registered (same module region)', () => {
    expect(moduleMeta('providers')).toContain(StoreWebhookHealthService);
    expect(moduleMeta('controllers')).toContain(StoreWebhookHealthController);
  });

  it('exposes the failure endpoints at the contracted routes', () => {
    // Controller prefix + per-method path/method metadata (Nest's
    // PATH_METADATA / METHOD_METADATA keys).
    expect(Reflect.getMetadata('path', WebhookFailuresController)).toBe('stores');
    const listPath = Reflect.getMetadata('path', (WebhookFailuresController.prototype as any).list);
    const replayPath = Reflect.getMetadata('path', (WebhookFailuresController.prototype as any).replay);
    const ignorePath = Reflect.getMetadata('path', (WebhookFailuresController.prototype as any).ignore);
    expect(listPath).toBe(':id/webhook-failures');
    expect(replayPath).toBe(':id/webhook-failures/:failureId/replay');
    expect(ignorePath).toBe(':id/webhook-failures/:failureId/ignore');
    // 0 = GET, 1 = POST (RequestMethod enum).
    expect(Reflect.getMetadata('method', (WebhookFailuresController.prototype as any).list)).toBe(0);
    expect(Reflect.getMetadata('method', (WebhookFailuresController.prototype as any).replay)).toBe(1);
    expect(Reflect.getMetadata('method', (WebhookFailuresController.prototype as any).ignore)).toBe(1);
  });
});
