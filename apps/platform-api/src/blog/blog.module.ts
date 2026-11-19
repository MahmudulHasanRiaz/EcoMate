import { Module } from '@nestjs/common';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { PublicBlogController } from './public-blog.controller';

@Module({
  controllers: [BlogController, PublicBlogController],
  providers: [BlogService],
  exports: [BlogService],
})
export class BlogModule {}
