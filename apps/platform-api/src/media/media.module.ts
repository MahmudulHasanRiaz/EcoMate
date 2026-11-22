import { Module } from '@nestjs/common';
import { AuditModule } from '../common/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MediaController } from './media.controller';
import { MediaStorageService } from './media-storage.service';
import { MediaService } from './media.service';
import { PublicAvatarController } from './public-avatar.controller';
import { PublicMediaController } from './public-media.controller';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [MediaController, PublicMediaController, PublicAvatarController],
  providers: [MediaService, MediaStorageService],
  exports: [MediaService, MediaStorageService],
})
export class MediaModule {}
