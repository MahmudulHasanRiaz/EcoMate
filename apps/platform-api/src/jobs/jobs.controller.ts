import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BillingJobsService, JOB_NAMES, JobName } from './billing-jobs.service';
import { TlsHealthService } from './tls-health.service';

@Controller('jobs')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class JobsController {
  constructor(
    private readonly jobs: BillingJobsService,
    private readonly tlsHealth: TlsHealthService,
  ) {}

  @Get()
  @Roles(...READ_ROLES)
  status() {
    return this.jobs.status();
  }

  // TLS/domain health (Phase 8 Stage 2 item 25). Declared before ':name/run'
  // so 'tls-health' is never matched as a billing job name.
  @Get('tls-health')
  @Roles(...READ_ROLES)
  tlsStatus() {
    return this.tlsHealth.status();
  }

  @Post('tls-health/run')
  @Roles('SUPERADMIN', 'BILLING')
  runTlsProbe() {
    return this.tlsHealth.runProbe();
  }

  // 'all/run' must be declared before ':name/run' or Nest matches it as a
  // job named "all".
  @Post('all/run')
  @Roles('SUPERADMIN', 'BILLING')
  runAll() {
    return this.jobs.runAll();
  }

  @Post(':name/run')
  @Roles('SUPERADMIN', 'BILLING')
  run(@Param('name') name: string) {
    if (!(JOB_NAMES as readonly string[]).includes(name)) {
      throw new NotFoundException(`Unknown job: ${name}`);
    }
    return this.jobs.runJob(name as JobName);
  }
}
