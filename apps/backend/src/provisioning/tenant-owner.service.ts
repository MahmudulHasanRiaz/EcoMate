import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { OwnerPasswordResetDto } from './dto/owner-password-reset.dto';

@Injectable()
export class TenantOwnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Triggers the tenant's existing OTP reset flow for the owner email. The
   * platform never sees or sets the password.
   */
  async sendPasswordReset(dto: OwnerPasswordResetDto) {
    const user = await this.prisma.userProfile.findFirst({
      where: { email: dto.email },
      select: { id: true, email: true },
    });
    if (user) {
      await this.auth.forgotPassword(user.email);
    }
    return { sent: true };
  }
}
