import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { CourierService } from './courier.service';

@Controller('courier')
@RequiresFeature('admin_courier')
export class CourierController {
  constructor(private readonly svc: CourierService) {}

  // Staff-only: looks up arbitrary phone numbers against a paid third-party
  // courier API. Customers must not be able to query other people's numbers.
  @Roles('superadmin', 'admin', 'employee')
  @Get('search')
  search(@Query('phone') phone: string) {
    if (!phone) throw new BadRequestException('Phone number required');
    return this.svc.search(phone);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get('summary')
  summary(@Query('phone') phone: string) {
    if (!phone) throw new BadRequestException('Phone number required');
    return this.svc.summary(phone);
  }
}
