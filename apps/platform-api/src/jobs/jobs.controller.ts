import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditService } from '../common/audit.service';
import { BillingJobsService, JOB_NAMES, JobName } from './billing-jobs.service';
import { TlsHealthService } from './tls-health.service';

@Controller('jobs')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class JobsController {
  constructor(
    private readonly jobs: BillingJobsService,
    private readonly tlsHealth: TlsHealthService,
    // AuditModule is @Global(), so no module wiring is needed.
    private readonly audit: AuditService,
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
  async runTlsProbe(@CurrentPlatformUser() user?: { id: string }) {
    const result = await this.tlsHealth.runProbe();
    // Only operator-triggered runs are audited (F6): the hourly scheduled
    // ticks would flood the log (5 jobs x 24/day). The result summary is
    // recorded so the audit shows what the run actually did.
    await this.audit.record({
      actorId: user?.id,
      action: 'jobs.tls-health.run',
      entity: 'Job',
      entityId: 'tls-health',
      after: {
        domainsChecked: result.domainsChecked,
        transitions: result.transitions.length,
        alertsSent: result.alertsSent,
        primaryHealthy: result.primaryHealthy,
        errors: result.errors,
      },
    });
    return result;
  }

  // 'all/run' must be declared before ':name/run' or Nest matches it as a
  // job named "all".
  @Post('all/run')
  @Roles('SUPERADMIN', 'BILLING')
  async runAll(@CurrentPlatformUser() user?: { id: string }) {
    const results = await this.jobs.runAll();
    await this.audit.record({
      actorId: user?.id,
      action: 'jobs.run-all',
      entity: 'Job',
      entityId: 'all',
      after: {
        results: results.map((r) => ({
          job: r.job,
          counts: r.counts,
          errors: r.errors,
        })),
      },
    });
    return results;
  }

  @Post(':name/run')
  @Roles('SUPERADMIN', 'BILLING')
  async run(
    @Param('name') name: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    if (!(JOB_NAMES as readonly string[]).includes(name)) {
      throw new NotFoundException(`Unknown job: ${name}`);
    }
    const result = await this.jobs.runJob(name as JobName);
    await this.audit.record({
      actorId: user?.id,
      action: 'jobs.run',
      entity: 'Job',
      entityId: name,
      after: { counts: result.counts, errors: result.errors },
    });
    return result;
  }
}
