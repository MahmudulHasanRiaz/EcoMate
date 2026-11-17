import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Static hello string — no data, no tenant context. Public by design
  // (the app e2e spec expects an unauthenticated 200 here).
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
