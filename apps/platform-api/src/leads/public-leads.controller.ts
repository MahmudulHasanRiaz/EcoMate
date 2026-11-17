import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { CreateLeadDto } from './dto/create-lead.dto';
import { LeadsService } from './leads.service';

function requestMeta(req: any) {
  return {
    ip: req?.ip || req?.socket?.remoteAddress || undefined,
    userAgent: Array.isArray(req?.headers?.['user-agent'])
      ? req.headers['user-agent'][0]
      : req?.headers?.['user-agent'],
  };
}

/** Public lead capture (landing lead form). No auth; per-IP rate limited. */
@Controller('public/leads')
export class PublicLeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateLeadDto, @Req() req: any) {
    return this.leads.create(dto, requestMeta(req));
  }
}
