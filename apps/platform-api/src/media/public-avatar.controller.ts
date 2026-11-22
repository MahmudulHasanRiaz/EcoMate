import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { MediaService } from './media.service';

/**
 * PUBLIC avatar bytes — no auth by design. An <img> cannot send a Bearer
 * token, so the avatar URL carries the capability instead: the
 * `?k=<avatarKey>` query must match the user's stored avatarKey (which
 * embeds a random UUID, like the media id in /public/media/:id), and
 * every failure answers the same 404. Only an authenticated console
 * session learns the key (via /auth/me or /users), so the photo is not
 * enumerable.
 *
 * Cache: `private, max-age=3600` (StackMate's 1h private cache). The key
 * changes whenever the avatar changes, so a changed photo is never
 * served stale. Headers mirror PublicMediaController: sandbox CSP,
 * nosniff, CORP cross-origin (the console on saas.* <img>s from api.*).
 * Headers are set on the Fastify reply — Express-style res.set() 500s
 * on Fastify (POS analytics lesson).
 */
@Controller('public/avatar')
export class PublicAvatarController {
  constructor(private readonly media: MediaService) {}

  @Get(':userId')
  async content(
    @Param('userId') userId: string,
    @Query('k') key: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const { bytes, mimeType } = await this.media.getAvatarContent(
      userId,
      key,
    );
    reply
      .header('Content-Type', mimeType)
      .header('Content-Length', bytes.byteLength)
      .header('Content-Disposition', 'inline')
      .header('Content-Security-Policy', 'sandbox')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .header('Cache-Control', 'private, max-age=3600');
    return reply.send(bytes);
  }
}
