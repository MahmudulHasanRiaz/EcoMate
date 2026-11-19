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
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdjustBalanceDto } from './dto/adjust-balance.dto';
import { CreateTopUpDto } from './dto/create-top-up.dto';
import { EmailBalanceService } from './email-balance.service';

/**
 * Console email-balance endpoints (smtp-balance-design.md §12.1).
 * The balance view is counts only — no money fields (enforced by the
 * money-visibility test). The top-up history endpoint is operator-only
 * and carries the payment amounts.
 */
@Controller('tenants/:tenantId')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class EmailBalanceController {
  constructor(private readonly emailBalance: EmailBalanceService) {}

  @Get('email-balance')
  @Roles(...READ_ROLES)
  getBalance(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: { ledgerPage?: string; ledgerLimit?: string },
  ) {
    return this.emailBalance.getBalance(tenantId, query);
  }

  @Post('email-topups')
  @Roles('SUPERADMIN', 'BILLING')
  createTopUp(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateTopUpDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.emailBalance.createTopUp(tenantId, dto.amountBDT, user?.id);
  }

  @Get('email-topups')
  @Roles(...READ_ROLES)
  topUpHistory(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: { status?: string; page?: string; limit?: string },
  ) {
    return this.emailBalance.topUpHistory(tenantId, query);
  }

  @Post('email-balance/adjust')
  @Roles('SUPERADMIN')
  adjustBalance(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: AdjustBalanceDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.emailBalance.adjustBalance(
      tenantId,
      dto.delta,
      dto.reason,
      user?.id,
    );
  }
}

/** Console overview widget data (GET /email-balance/overview). */
@Controller('email-balance')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class EmailBalanceOverviewController {
  constructor(private readonly emailBalance: EmailBalanceService) {}

  @Get('overview')
  @Roles(...READ_ROLES)
  overview() {
    return this.emailBalance.overview();
  }
}
