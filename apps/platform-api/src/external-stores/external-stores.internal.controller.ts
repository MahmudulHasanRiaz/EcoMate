import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InternalServiceGuard } from '../internal/internal-service.guard';
import {
  ClaimBindingDto,
  STORE_PROVIDERS,
  type StoreProviderSlug,
} from './dto/claim-binding.dto';
import { SyncReportDto } from './dto/sync-report.dto';
import { UpdateBindingStatusDto } from './dto/update-binding-status.dto';
import { ExternalStoresService } from './external-stores.service';

/**
 * Internal external-store binding endpoints (Phase 9 §3.4) — the
 * contract the tenant backend's ExternalStoreResolver + connect flow
 * call. Guarded by InternalServiceGuard (x-platform-service-token),
 * same as InternalController. All responses are generic: an unknown
 * store and an unbound store are indistinguishable (no oracle).
 */
@Controller('internal/external-stores')
@UseGuards(InternalServiceGuard)
export class ExternalStoresInternalController {
  constructor(private readonly bindings: ExternalStoresService) {}

  /**
   * Resolve a store to its tenant: ?storeId=... (webhook / bridge
   * intake) or ?provider=...&domain=... (Shopify install landing).
   * Returns { tenantId, status }; generic 404 when unknown.
   */
  @Get('resolve')
  async resolve(
    @Query('storeId') storeId?: string,
    @Query('provider') provider?: string,
    @Query('domain') domain?: string,
  ) {
    if (storeId) return this.bindings.resolveByStoreId(storeId);
    if (provider || domain) {
      if (!provider || !domain) {
        throw new BadRequestException(
          'provider and domain are required together',
        );
      }
      if (
        !(STORE_PROVIDERS as readonly string[]).includes(provider)
      ) {
        throw new BadRequestException('Unknown provider');
      }
      return this.bindings.resolveByProviderDomain(
        provider as StoreProviderSlug,
        domain,
      );
    }
    throw new BadRequestException(
      'storeId or provider+domain is required',
    );
  }

  /** Claim a binding for a pre-generated storeId (connect flow). */
  @Post('claim')
  claim(@Body() dto: ClaimBindingDto) {
    return this.bindings.claim(dto);
  }

  /** Release a PENDING binding (connect-flow failure path). */
  @Post(':storeId/release')
  @HttpCode(200)
  release(@Param('storeId', ParseUUIDPipe) storeId: string) {
    return this.bindings.release(storeId);
  }

  /** Status update from the tenant backend (connect success, disconnect). */
  @Post(':storeId/status')
  @HttpCode(200)
  updateStatus(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body() dto: UpdateBindingStatusDto,
  ) {
    return this.bindings.updateStatus(storeId, dto.status);
  }

  /** Sync-health report from the tenant backend (console panel data). */
  @Post(':storeId/sync-report')
  @HttpCode(200)
  syncReport(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body() dto: SyncReportDto,
  ) {
    return this.bindings.syncReport(storeId, dto);
  }
}
