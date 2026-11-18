import { Module } from '@nestjs/common';
import { AuditModule } from '../common/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MediaController } from './media.controller';
import { MediaStorageService } from './media-storage.service';
import { MediaService } from './media.service';
import { PublicMediaController } from './public-media.controller';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [MediaController, PublicMediaController],
  providers: [MediaService, MediaStorageService],
  exports: [MediaService, MediaStorageService],
})
export class MediaModule {}
