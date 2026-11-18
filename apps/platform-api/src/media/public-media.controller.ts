import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { MediaService } from './media.service';

/**
 * PUBLIC media bytes — no auth by design. Library files are landing /
 * branding assets (logos, landing images) that the public landing
 * renders for anonymous visitors; the library itself (list / upload /
 * manage) stays behind PlatformAuthGuard in MediaController.
 *
 * Bytes at an id NEVER change (a re-upload creates a new row), so the
 * response is immutable + long-cached. SVG is sanitized at upload AND
 * served with a sandbox CSP here, so a stored SVG can never carry an
 * active payload even if opened top-level. `?download=1` serves the
 * file as an attachment with its original filename.
 *
 * Headers are set on the Fastify reply (the backend's @fastify/static
 * setHeaders pattern) — Express-style res.set() 500s on Fastify (POS
 * analytics lesson), and StreamableFile cannot carry the sandbox CSP.
 */
@Controller('public/media')
export class PublicMediaController {
  constructor(private readonly media: MediaService) {}

  @Get(':id')
  async content(
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const { row, bytes, mimeType } = await this.media.getContent(id);
    const safeName = row.originalFilename
      .replace(/["\\\r\n]/g, '_')
      .slice(0, 200);
    const disposition =
      download === '1'
        ? `attachment; filename="${safeName}"`
        : 'inline';
    reply
      .header('Content-Type', mimeType)
      .header('Content-Length', bytes.byteLength)
      .header('Content-Disposition', disposition)
      .header('Content-Security-Policy', 'sandbox')
      .header('X-Content-Type-Options', 'nosniff')
      // Helmet sets Cross-Origin-Resource-Policy: same-origin globally;
      // these bytes are MEANT to be embedded cross-origin (the landing
      // on www.* and the console on saas.* both <img> them from api.*),
      // so this endpoint overrides it. Without this, Chrome blocks the
      // <img> load and every thumbnail renders broken.
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(bytes);
  }
}
