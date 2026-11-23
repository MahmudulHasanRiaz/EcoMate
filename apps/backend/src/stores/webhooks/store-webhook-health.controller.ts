/**
 * Webhook health summary — Phase 9 P2 (J-12).
 *
 *   GET /stores/:id/webhooks/health
 *
 * Operator read: delivery counts, ingest failure rate, open issues and
 * a hook-status heuristic for one store, from stored data only (no
 * live provider call). The console can show it later; the endpoint
 * also drives the failure-rate alert (structured log + issue row) on
 * every read, fire-and-forget.
 *
 * Same double gate as StoresController (BR-25): `@RequiresFeature(
 * 'admin_stores')` + the fail-closed `storesEnabled()` flag. Kept in
 * its own controller file (not StoresController — Builder A owns it,
 * Builder B owns webhook-failures.controller.ts).
 */
import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../../common/decorators/roles.decorator';
import { storesEnabled } from '../store-flags';
import { StoreWebhookHealthService } from './store-webhook-health.service';

@Roles('superadmin', 'admin', 'employee')
@Controller('stores')
@RequiresFeature('admin_stores')
export class StoreWebhookHealthController {
  constructor(private readonly health: StoreWebhookHealthService) {}

  @Get(':id/webhooks/health')
  async getHealth(@Param('id', ParseUUIDPipe) id: string) {
    if (!storesEnabled()) {
      throw new ForbiddenException('Third-party stores are disabled');
    }
    const summary = await this.health.getHealth(id);
    // Failure-rate alert on read — fire-and-forget, never fails the
    // response (evaluateAndAlert is itself non-throwing).
    void this.health.evaluateAndAlert(id, summary).catch(() => undefined);
    return summary;
  }
}
