import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentPlatformUser } from '../auth/current-platform-user.decorator';
import { ConsoleAuthModeGuard } from '../auth/console-auth-mode.guard';
import { READ_ROLES, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditService } from '../common/audit.service';
import { MoveMediaDto } from './dto/move-media.dto';
import { RenameMediaDto } from './dto/rename-media.dto';
import { UpdateMediaTagsDto } from './dto/update-media-tags.dto';
import { UpdateStorageSettingsDto } from './dto/update-storage-settings.dto';
import { MediaStorageService } from './media-storage.service';
import { MediaService } from './media.service';

/**
 * Operator media library. Reads follow the platform READ_ROLES
 * convention; writes are SUPERADMIN/BILLING (media is website
 * content, like Landing). The storage-driver switch is SUPERADMIN
 * only (infra-level — a wrong switch hides stored files).
 *
 * Upload is multipart, one file per request (the console uploads one
 * at a time); folder + tags ride as query params because the body is
 * the file part.
 */
@Controller('media')
@UseGuards(ConsoleAuthModeGuard, RolesGuard)
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly storage: MediaStorageService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles(...READ_ROLES)
  list(
    @Query('q') q?: string,
    @Query('kind') kind?: string,
    @Query('folder') folder?: string,
    @Query('mime') mime?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.media.list({
      q,
      kind,
      folder,
      mimes: mime ? mime.split(',') : undefined,
      limit: limit === undefined ? undefined : Number(limit),
      offset: offset === undefined ? undefined : Number(offset),
    });
  }

  // NOTE: 'folders', 'stats' and 'storage' must be declared BEFORE
  // ':id' or they match the :id route and fail the UUID pipe.
  @Get('folders')
  @Roles(...READ_ROLES)
  folders() {
    return this.media.listFolders();
  }

  @Get('stats')
  @Roles(...READ_ROLES)
  stats() {
    return this.media.stats();
  }

  @Get('storage')
  @Roles(...READ_ROLES)
  storageSettings() {
    return this.storage.getSettings();
  }

  @Put('storage')
  @Roles('SUPERADMIN')
  async updateStorageSettings(
    @Body() dto: UpdateStorageSettingsDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    const before = await this.storage.getSettings();
    const after = await this.storage.updateSettings(dto);
    await this.audit.record({
      actorId: user?.id,
      action: 'media.storage.updated',
      entity: 'MediaStorageSettings',
      entityId: 'media',
      before: { driver: before.driver, localPath: before.localPath },
      after: { driver: after.driver, localPath: after.localPath },
    });
    return after;
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.media.detail(id);
  }

  @Get(':id/usage')
  @Roles(...READ_ROLES)
  usage(@Param('id', ParseUUIDPipe) id: string) {
    return this.media.usage(id);
  }

  @Post()
  @Roles('SUPERADMIN', 'BILLING')
  async upload(
    @Req() req: FastifyRequest,
    @Query('folder') folder?: string,
    @Query('tags') tags?: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    const file = await req.file();
    if (!file) {
      throw new BadRequestException('No file was uploaded.');
    }
    const bytes = await file.toBuffer();
    return this.media.upload(
      {
        bytes,
        declaredMimeType: file.mimetype,
        filename: file.filename,
        folder,
        tags: tags ? tags.split(',') : undefined,
      },
      user?.id ?? null,
    );
  }

  @Patch(':id/rename')
  @Roles('SUPERADMIN', 'BILLING')
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameMediaDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.media.rename(id, dto.originalFilename, user?.id);
  }

  @Patch(':id/move')
  @Roles('SUPERADMIN', 'BILLING')
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveMediaDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.media.move(id, dto.folder, user?.id);
  }

  @Patch(':id/tags')
  @Roles('SUPERADMIN', 'BILLING')
  updateTags(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMediaTagsDto,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    return this.media.setTags(id, dto.tags, user?.id);
  }

  @Delete(':id')
  @HttpCode(200)
  @Roles('SUPERADMIN', 'BILLING')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() user?: { id: string },
  ) {
    await this.media.delete(id, user?.id);
    return { deleted: true };
  }
}
