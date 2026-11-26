// Phase 3 central-auth cutover — global module exposing CentralAuthClient
// so the guard and the users/employees/customers/auth services can inject
// it without importing each other's modules.
import { Global, Module } from '@nestjs/common';
import { CentralAuthClient } from './central-auth.client';

@Global()
@Module({
  providers: [CentralAuthClient],
  exports: [CentralAuthClient],
})
export class CentralAuthModule {}
