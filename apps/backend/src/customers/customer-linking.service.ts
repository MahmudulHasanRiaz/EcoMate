import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { baPrisma } from '../better-auth/prisma';
import { CentralAuthClient } from '../auth/central-auth.client';
import { isCentralAuthMode } from '../common/tenant-auth-mode';

@Injectable()
export class CustomerLinkingService {
  constructor(
    private prisma: PrismaService,
    // Central auth client (global module). @Optional so unit tests that
    // construct the service by hand keep working.
    @Optional()
    private readonly centralAuth?: CentralAuthClient,
  ) {}

  async linkByEmail(customerProfileId: string, email: string) {
    if (!email) return;

    // Phase 3: in central-ba mode the email lookup runs against the
    // central service (never the tenant BA rows). linkByPhone is
    // unchanged — it never touched BA.
    let baUserId: string | undefined;
    if (isCentralAuthMode()) {
      if (!this.centralAuth) {
        throw new ServiceUnavailableException(
          'Central auth client is not configured',
        );
      }
      baUserId = (await this.centralAuth.getCentralUserByEmail(email))?.id;
    } else {
      baUserId = (
        await baPrisma.betterAuthUser.findFirst({ where: { email } })
      )?.id;
    }
    if (!baUserId) return;

    const profile = await this.prisma.customerProfile.findFirst({
      where: { id: customerProfileId },
    });
    if (profile?.betterAuthUserId) return;

    await this.prisma.customerProfile.update({
      where: { id: customerProfileId },
      data: { betterAuthUserId: baUserId },
    });
  }

  async linkByPhone(betterAuthUserId: string, phone: string) {
    if (!phone) return;

    const profile = await this.prisma.customerProfile.findFirst({
      where: { phone, betterAuthUserId: null },
    });
    if (!profile) return;

    await this.prisma.customerProfile.update({
      where: { id: profile.id },
      data: { betterAuthUserId },
    });
  }
}
