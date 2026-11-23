/**
 * Stores controller — central-commerce §10 (P1: Stores subset).
 *
 * Double-gated (BR-25): `@RequiresFeature('admin_stores')` AND the
 * fail-closed runtime flags (`THIRD_PARTY_STORES_ENABLED` +
 * `store_sync_enabled`). Reads never include secrets; credentials rotate
 * through a write-only endpoint.
 *
 * Sync-run endpoints (`POST /stores/:id/sync`, `/sync/*`) land with the
 * sync engine in P4; the P1 `sync` route below answers 501 explicitly
 * rather than silently queuing nothing.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { BillingArea } from '../tenancy/billing-area.decorator';
import { RequiresLimit } from '../entitlements/requires-limit.decorator';
import { StoresService } from './stores.service';
import { SyncQueuesService } from './sync/sync-queues.service';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { StoreProductImportService } from './sync/store-product-import.service';
import { productSyncEnabled, storesEnabled } from './store-flags';
import {
  CreateStoreDto,
  RotateStoreCredentialsDto,
  TestConnectionDto,
  UpdateStoreDto,
} from './dto/stores.dto';
import {
  CreateImportSkipDto,
  ImportCatalogQueryDto,
  StartImportDto,
} from './dto/import.dto';

@Roles('superadmin', 'admin', 'employee')
@Controller('stores')
@RequiresFeature('admin_stores')
export class StoresController {
  constructor(
    private readonly stores: StoresService,
    private readonly queues: SyncQueuesService,
    private readonly registry: ProviderRegistryService,
    private readonly imports: StoreProductImportService,
  ) {}

  private assertEnabled(): void {
    if (!storesEnabled()) {
      throw new ForbiddenException('Third-party stores are disabled');
    }
  }

  @Get()
  list() {
    this.assertEnabled();
    return this.stores.list();
  }

  @Post()
  @Roles('superadmin', 'admin')
  // SaaS §5.2: the `external_stores` plan limit is enforced here (guard)
  // AND in the service (non-HTTP callers); `admin_writes` puts connect
  // under strict blocking (a workspace change).
  @RequiresLimit('external_stores')
  @BillingArea('admin_writes')
  create(@Body() dto: CreateStoreDto, @CurrentUser() user?: any) {
    this.assertEnabled();
    return this.stores.connect(dto, user?.sub);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    this.assertEnabled();
    return this.stores.detail(id);
  }

  @Patch(':id')
  @Roles('superadmin', 'admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStoreDto) {
    this.assertEnabled();
    return this.stores.update(id, dto);
  }

  /** Disconnect — retains identity, mappings, history (§8.10). */
  @Delete(':id')
  @Roles('superadmin', 'admin')
  disconnect(@Param('id', ParseUUIDPipe) id: string) {
    this.assertEnabled();
    return this.stores.disconnect(id);
  }

  /** Write-only credential rotation — never echoes the payload. */
  @Post(':id/credentials')
  @Roles('superadmin', 'admin')
  rotateCredentials(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RotateStoreCredentialsDto,
    @CurrentUser() user?: any,
  ) {
    this.assertEnabled();
    return this.stores.rotateCredentials(id, dto, user?.sub);
  }

  @Post(':id/test-connection')
  testConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TestConnectionDto,
  ) {
    this.assertEnabled();
    return this.stores.testConnection(id, dto);
  }

  /** Re-auth onto the same Store row (§8.10). */
  @Post(':id/reconnect')
  @Roles('superadmin', 'admin')
  reconnect(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RotateStoreCredentialsDto,
    @CurrentUser() user?: any,
  ) {
    this.assertEnabled();
    return this.stores.reconnect(id, dto, user?.sub);
  }

  @Get(':id/health')
  health(@Param('id', ParseUUIDPipe) id: string) {
    this.assertEnabled();
    return this.stores.health(id);
  }

  /** Provider hook registration (P4 live). */
  @Post(':id/webhooks/ensure')
  @Roles('superadmin', 'admin')
  async ensureWebhooks(@Param('id', ParseUUIDPipe) id: string) {
    this.assertEnabled();
    const store = await this.stores.detail(id);
    const provider = this.registry.providerFor({ kind: (store as any).kind });
    const full = await this.stores.storeWithSecrets(id);
    return provider.ensureWebhooks(full, resolveWebhookCallbackBase());
  }

  /**
   * Manual sync trigger (`{ scope } → { runId }`, BR-21: returns now).
   *
   * SaaS §5.1: gated by `store_product_sync` (the upstream gap — the key
   * was enforced NOWHERE upstream, so a tenant holding only `admin_stores`
   * could sync products). D11 note: FeatureGuard uses getAllAndOverride,
   * so this method-level key REPLACES the class-level `admin_stores` on
   * this route, and the guard ignores catalog dependencies — a tenant
   * with `store_product_sync` but not `admin_stores` would still pass.
   * That is the documented baseline gap (ruling D11: do not change the
   * guard); in practice the add-on bundles the keys (plan §5.3), and the
   * enqueue entitlement check is the second layer.
   */
  @Post(':id/sync')
  @Roles('superadmin', 'admin')
  @RequiresFeature('store_product_sync')
  async triggerSync(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { scope?: string },
    @CurrentUser() user?: any,
  ) {
    this.assertEnabled();
    if (!productSyncEnabled()) {
      throw new ForbiddenException('Product sync is disabled');
    }
    await this.stores.detail(id);
    const scope = (body.scope ?? 'PRODUCT') as 'PRODUCT' | 'PUBLISH';
    return this.queues.triggerStoreSync(id, scope, user?.sub);
  }

  // ── WooCommerce product import (§7.1) ────────────────────────────────
  //
  // Guards (R8/D13): `@RequiresFeature('store_product_sync')` (method-level,
  // same D11 replacement note as triggerSync) + the named grantable
  // permission `import_products_external_stores`. Superadmin/admin hold all
  // permissions by default; employees need the grant via an HR preset
  // (PermissionsGuard has no role bypass).

  /** Review catalog: remote products + match suggestions + linked/skip/new flags. */
  @Get(':id/import-catalog')
  @RequiresFeature('store_product_sync')
  @Permissions('import_products_external_stores')
  importCatalog(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ImportCatalogQueryDto,
  ) {
    this.assertEnabled();
    return this.imports.fetchCatalog(id, query);
  }

  /** Confirm the review: returns `{ runId, deduped }` immediately (BR-21). */
  @Post(':id/import')
  @RequiresFeature('store_product_sync')
  @Permissions('import_products_external_stores')
  startImport(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartImportDto,
    @CurrentUser() user?: any,
  ) {
    this.assertEnabled();
    return this.imports.startImport(id, dto, user?.sub);
  }

  /** Retry a finished batch's FAILED items only (§10.5). */
  @Post(':id/import/runs/:runId/retry')
  @RequiresFeature('store_product_sync')
  @Permissions('import_products_external_stores')
  retryImport(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser() user?: any,
  ) {
    this.assertEnabled();
    return this.imports.retryFailedImport(runId, user?.sub, id);
  }

  /** Background image progress for a batch (R5). */
  @Get(':id/import/runs/:runId/image-status')
  @RequiresFeature('store_product_sync')
  @Permissions('import_products_external_stores')
  importImageStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    this.assertEnabled();
    return this.imports.imageStatus(runId, id);
  }

  /** Skipped remote products for this store (review screen + management). */
  @Get(':id/import-skips')
  @RequiresFeature('store_product_sync')
  @Permissions('import_products_external_stores')
  listImportSkips(@Param('id', ParseUUIDPipe) id: string) {
    this.assertEnabled();
    return this.imports.listSkips(id);
  }

  @Post(':id/import-skips')
  @RequiresFeature('store_product_sync')
  @Permissions('import_products_external_stores')
  createImportSkip(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateImportSkipDto,
    @CurrentUser() user?: any,
  ) {
    this.assertEnabled();
    return this.imports.createSkip(id, dto.remoteId, dto.note, user?.sub);
  }

  /** Un-skip one remote product (it reappears as importable). */
  @Delete(':id/import-skips/:remoteId')
  @RequiresFeature('store_product_sync')
  @Permissions('import_products_external_stores')
  deleteImportSkip(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('remoteId') remoteId: string,
  ) {
    this.assertEnabled();
    return this.imports.deleteSkip(id, remoteId);
  }

  /** Clear all skips for this store. */
  @Delete(':id/import-skips')
  @RequiresFeature('store_product_sync')
  @Permissions('import_products_external_stores')
  clearImportSkips(@Param('id', ParseUUIDPipe) id: string) {
    this.assertEnabled();
    return this.imports.clearSkips(id);
  }
}

/**
 * Resolve the public callback base for provider webhook registration.
 * A relative URL is doomed (Shopify 422s "address is invalid") — fail
 * loudly here instead of registering garbage. Exported for unit tests.
 */
export function resolveWebhookCallbackBase(
  env: Record<string, string | undefined> = process.env,
): string {
  const base = String(env.PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base)) {
    throw new BadRequestException(
      'Webhook callback base URL is not configured (PUBLIC_API_BASE_URL must be an https:// URL)',
    );
  }
  return base;
}
