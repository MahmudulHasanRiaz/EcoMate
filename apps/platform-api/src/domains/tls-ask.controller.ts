import {
  Controller,
  Get,
  NotFoundException,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { DomainsService } from './domains.service';

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Caddy on-demand TLS "ask" endpoint.
 *
 * Caddy calls GET <ask-url>?domain=<host> and issues a certificate only for a
 * 2xx response. Caddy cannot send custom headers, so the shared secret rides a
 * query parameter (Caddyfile: ...allow?token={env.TLS_ASK_TOKEN}); the endpoint
 * must stay on the private network. Only known tenant hosts are allowed:
 * SUBDOMAIN domains always, CUSTOM domains only once VERIFIED.
 */
@Controller('internal/tls')
export class TlsAskController {
  constructor(private readonly domains: DomainsService) {}

  @Get('allow')
  async allow(@Query('domain') domain: string, @Query('token') token: string) {
    const expected =
      process.env.TLS_ASK_TOKEN || process.env.INTERNAL_SERVICE_SECRET;
    if (!expected) {
      throw new ServiceUnavailableException(
        'TLS ask endpoint is not configured',
      );
    }
    if (!token || !safeEqual(String(token), expected)) {
      throw new UnauthorizedException('Unauthorized');
    }
    if (!domain || !(await this.domains.isTlsHostAllowed(String(domain)))) {
      throw new NotFoundException('Host is not allowed');
    }
    return { allow: true, domain: String(domain).trim().toLowerCase() };
  }
}
