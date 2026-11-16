import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { CreateSignupDto } from './dto/create-signup.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { RetryProvisioningDto } from './dto/retry-provisioning.dto';
import { SignupService } from './signup.service';

function requestMeta(req: any) {
  return {
    ip: req?.ip || req?.socket?.remoteAddress || undefined,
    userAgent: Array.isArray(req?.headers?.['user-agent'])
      ? req.headers['user-agent'][0]
      : req?.headers?.['user-agent'],
  };
}

@Controller('public/signup')
export class SignupController {
  constructor(private readonly signup: SignupService) {}

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateSignupDto, @Req() req: any) {
    return this.signup.create(dto, requestMeta(req));
  }

  @Get('verify')
  verify(@Query('token') token?: string) {
    return this.signup.verify(token ?? '');
  }

  @Get('status')
  status(@Query('token') token?: string) {
    return this.signup.status(token ?? '');
  }

  @Post('resend')
  @HttpCode(200)
  resend(@Body() dto: ResendVerificationDto, @Req() req: any) {
    return this.signup.resend(dto, requestMeta(req));
  }

  @Post('retry')
  @HttpCode(202)
  retry(@Body() dto: RetryProvisioningDto) {
    return this.signup.retryProvisioning(dto.token);
  }
}
