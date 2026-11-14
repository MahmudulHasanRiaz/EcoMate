import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

export interface PlatformSessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly jwt: JwtService,
  ) {}

  private accessSecret(): string {
    const secret = process.env.PLATFORM_JWT_SECRET;
    if (!secret) throw new Error('PLATFORM_JWT_SECRET is not set');
    return secret;
  }

  private refreshSecret(): string {
    const secret = process.env.PLATFORM_JWT_REFRESH_SECRET;
    if (!secret) throw new Error('PLATFORM_JWT_REFRESH_SECRET is not set');
    return secret;
  }

  private accessTtlSeconds(): number {
    return Number(process.env.PLATFORM_JWT_EXPIRES_IN_SECONDS ?? 900);
  }

  private refreshTtlSeconds(): number {
    return Number(process.env.PLATFORM_JWT_REFRESH_EXPIRES_IN_SECONDS ?? 604800);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async issueTokens(user: PlatformSessionUser) {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role, type: 'platform' },
      { secret: this.accessSecret(), expiresIn: this.accessTtlSeconds() },
    );

    const tokenJti = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: tokenJti, type: 'platform-refresh' },
      { secret: this.refreshSecret(), expiresIn: this.refreshTtlSeconds() },
    );
    const expiresAt = new Date(Date.now() + this.refreshTtlSeconds() * 1000);

    await this.prisma.platformRefreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTtlSeconds(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.platformUser.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid platform credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid platform credentials');
    }

    await this.prisma.platformUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueTokens({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  }

  async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.refreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload?.type !== 'platform-refresh' || !payload.sub) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const row = await this.prisma.platformRefreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
    });
    if (!row || row.revokedAt || row.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    const user = await this.prisma.platformUser.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Platform account is not active');
    }

    await this.prisma.platformRefreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  }

  async logout(refreshToken: string) {
    const hash = this.hashToken(refreshToken);
    await this.prisma.platformRefreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  async me(userId: string) {
    const user = await this.prisma.platformUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        lastLoginAt: true,
      },
    });
    if (!user) throw new UnauthorizedException('Platform account not found');
    return user;
  }
}
