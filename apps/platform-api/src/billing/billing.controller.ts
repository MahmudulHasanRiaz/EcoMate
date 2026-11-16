import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BillingService } from './billing.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { RejectProofDto } from './dto/reject-proof.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';

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

  @Post('methods')
  @Roles('SUPERADMIN', 'BILLING')
  createMethod(
    @Body() dto: CreatePaymentMethodDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.billing.createMethod(dto, user?.id);
  }

  @Patch('methods/:id')
  @Roles('SUPERADMIN', 'BILLING')
  updateMethod(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentMethodDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.billing.updateMethod(id, dto, user?.id);
  }

  @Delete('methods/:id')
  @Roles('SUPERADMIN', 'BILLING')
  deleteMethod(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.billing.deleteMethod(id, user?.id);
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

  @Get('subscriptions')
  subscriptions(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.billing.subscriptions({ status, page, limit });
  }

  @Get('credit-notes')
  creditNotes(
    @Query('tenantId') tenantId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.billing.creditNotes({ tenantId, page, limit });
  }

  @Post('credit-notes')
  @Roles('SUPERADMIN', 'BILLING')
  createCreditNote(
    @Body() dto: CreateCreditNoteDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.billing.createCreditNote(dto, user?.id);
  }

  @Get('coupons')
  coupons(
    @Query('active') active?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.billing.coupons({ active, page, limit });
  }

  @Post('coupons')
  @Roles('SUPERADMIN', 'BILLING')
  createCoupon(
    @Body() dto: CreateCouponDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.billing.createCoupon(dto, user?.id);
  }

  @Patch('coupons/:id')
  @Roles('SUPERADMIN', 'BILLING')
  updateCoupon(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCouponDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.billing.updateCoupon(id, dto, user?.id);
  }
}
