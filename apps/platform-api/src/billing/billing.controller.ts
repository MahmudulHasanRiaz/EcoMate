import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BillingService } from './billing.service';
import { RejectProofDto } from './dto/reject-proof.dto';

@Controller('billing')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('summary')
  summary() {
    return this.billing.summary();
  }

  @Get('methods')
  methods() {
    return this.billing.methods();
  }

  @Get('proofs')
  proofs(
    @Query('status') status?: string,
    @Query('tenantId') tenantId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.billing.proofQueue({ status, tenantId, page, limit });
  }

  @Get('proofs/:id')
  proof(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.proofDetail(id);
  }

  @Post('proofs/:id/approve')
  @Roles('SUPERADMIN', 'BILLING', 'SUPPORT')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.billing.approveProof(id, user?.id);
  }

  @Post('proofs/:id/reject')
  @Roles('SUPERADMIN', 'BILLING', 'SUPPORT')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectProofDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.billing.rejectProof(id, dto.reason, user?.id);
  }

  @Get('invoices')
  invoices(
    @Query('status') status?: string,
    @Query('tenantId') tenantId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.billing.invoices({ status, tenantId, search, page, limit });
  }

  @Get('invoices/:id')
  invoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.invoiceDetail(id);
  }

  @Get('payments')
  payments(
    @Query('tenantId') tenantId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.billing.payments({ tenantId, page, limit });
  }
}
