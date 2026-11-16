import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BillingJobsService, JOB_NAMES, JobName } from './billing-jobs.service';

@Controller('jobs')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class JobsController {
  constructor(private readonly jobs: BillingJobsService) {}

  @Get()
  status() {
    return this.jobs.status();
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
