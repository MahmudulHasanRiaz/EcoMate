import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { PlatformAuthGuard } from '../auth/platform-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditQueryService } from './audit-query.service';
import type { AuditQuery } from './audit-query.service';

const READ_ROLES = ['SUPERADMIN', 'BILLING', 'SUPPORT'] as const;
const EXPORT_ROLES = ['SUPERADMIN', 'BILLING'] as const;

@Controller('audit')
@UseGuards(PlatformAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @Roles(...READ_ROLES)
  list(@Query() query: AuditQuery) {
    return this.audit.list(query);
  }

  @Get('export')
  @Roles(...EXPORT_ROLES)
  async export(@Query() query: AuditQuery & { format?: string }) {
    const format = (query.format ?? 'csv').toLowerCase();
    if (format !== 'csv' && format !== 'json') {
      throw new BadRequestException('format must be csv or json');
    }
    const { rows, truncated } = await this.audit.exportRows(query);
    const stamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 14);
    const body =
      format === 'json'
        ? JSON.stringify({ data: rows, truncated }, null, 2)
        : this.audit.toCsv(rows);
    // StreamableFile, not @Res(): the app runs Fastify, where Express-style
    // res.set() 500s (POS analytics lesson).
    return new StreamableFile(Buffer.from(body, 'utf-8'), {
      type:
        format === 'json'
          ? 'application/json; charset=utf-8'
          : 'text/csv; charset=utf-8',
      disposition: `attachment; filename="audit-export-${stamp}.${format}"`,
    });
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  detail(@Param('id') id: string) {
    return this.audit.detail(id);
  }
}
