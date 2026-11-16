import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SkipSubscription } from '../tenancy/skip-subscription.decorator';
import { requireTenantId } from '../tenancy/tenant-context';
import { TenantBillingService } from './billing.service';
import { SubmitProofDto } from './dto/submit-proof.dto';

/**
 * Tenant-facing billing. The whole controller skips the subscription guard
 * on purpose: a suspended or read-only tenant must still see its invoices
 * and pay them — billing is the way back to full access. The tenant id
 * always comes from the tenant context, never from the request.
 */
@SkipSubscription()
@Controller('billing')
export class TenantBillingController {
  constructor(private readonly billing: TenantBillingService) {}

  @Get('methods')
  @Roles('superadmin', 'admin', 'employee')
  methods() {
    return this.billing.methods();
  }

  @Get('invoices')
  @Roles('superadmin', 'admin', 'employee')
  invoices() {
    return this.billing.invoices(requireTenantId());
  }

  @Get('invoices/:id')
  @Roles('superadmin', 'admin', 'employee')
  invoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.invoice(requireTenantId(), id);
  }

  @Post('invoices/:id/proofs')
  @Roles('superadmin', 'admin')
  submitProof(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitProofDto,
  ) {
    return this.billing.submitProof(requireTenantId(), id, dto);
  }

  @Get('invoices/:id/pdf')
  @Roles('superadmin', 'admin', 'employee')
  async invoicePdf(@Param('id', ParseUUIDPipe) id: string) {
    const { stream, filename } = await this.billing.invoicePdf(
      requireTenantId(),
      id,
    );
    return new StreamableFile(stream as any, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
