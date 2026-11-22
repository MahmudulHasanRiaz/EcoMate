import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { PlatformBindingClient } from './platform-binding.client';
import { ExternalStoreResolver } from './external-store-resolver.service';

/**
 * External stores (Phase 9 §3.3–§3.4): the platform binding client +
 * the tenant resolver. Imported by StoresModule (connect / intake /
 * install) and ProvisioningModule (tenant purge releases bindings).
 * Deliberately free of any StoresModule import — the resolver must stay
 * usable from contexts that never load the sync engine.
 */
@Module({
  imports: [CacheModule],
  providers: [PlatformBindingClient, ExternalStoreResolver],
  exports: [PlatformBindingClient, ExternalStoreResolver],
})
export class ExternalStoresModule {}
