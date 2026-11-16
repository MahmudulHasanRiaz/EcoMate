import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { DomainConfigService } from '../config/domain-config.service';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { CaptchaService } from './captcha.service';
import { CreateSignupDto } from './dto/create-signup.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { PlatformMailService } from '../common/platform-mail.service';
import { SignupRateLimitService } from './signup-rate-limit.service';
import { isDisposableEmail } from './signup-disposable';
import { normalizePhone, phoneVariants } from './signup-phone';
import { validateSlug } from './signup-slug';

const IP_WINDOW_MS = 10 * 60_000;
const EMAIL_WINDOW_MS = 60 * 60_000;
const RESEND_WINDOW_MS = 10 * 60_000;
const IP_LIMIT = 5;
const EMAIL_LIMIT = 3;
const RESEND_LIMIT = 3;
const TOKEN_TTL_MS = 24 * 60 * 60_000;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface SignupRequestMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly captcha: CaptchaService,
    private readonly rateLimit: SignupRateLimitService,
    private readonly mail: PlatformMailService,
    private readonly provisioning: ProvisioningService,
    private readonly domainConfig: DomainConfigService,
  ) {}

  async create(dto: CreateSignupDto, meta: SignupRequestMeta = {}) {
    const ipKey = meta.ip || 'unknown';
    this.rateLimit.assert(`signup:ip:${ipKey}`, IP_LIMIT, IP_WINDOW_MS);
    this.assertHoneypot(dto.website);
    await this.assertCaptcha(dto.captchaToken, meta.ip);

    const slugCheck = validateSlug(dto.slug);
    if (!slugCheck.ok) throw new BadRequestException(slugCheck.message);
    const slug = slugCheck.slug;
    const ownerEmail = dto.ownerEmail.trim().toLowerCase();
    const ownerPhone = normalizePhone(dto.ownerPhone);

    if (isDisposableEmail(ownerEmail)) {
      throw new BadRequestException(
        'Disposable email addresses are not supported. Use a permanent address.',
      );
    }

    await this.expireStale();
    await this.assertAvailable(slug, ownerEmail, ownerPhone);
    this.rateLimit.assert(`signup:email:${ownerEmail}`, EMAIL_LIMIT, EMAIL_WINDOW_MS);

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const token = randomBytes(32).toString('hex');
    const now = new Date();

    const signup = await this.prisma.signupRequest.create({
      data: {
        tenantName: dto.tenantName.trim(),
        slug,
        ownerEmail,
        ownerPhone,
        passwordHash,
        status: 'PENDING_EMAIL',
        verificationTokenHash: sha256(token),
        verificationExpiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
        ipAddress: meta.ip || null,
        userAgent: meta.userAgent || null,
      },
    });

    try {
      await this.mail.sendVerification({
        to: ownerEmail,
        tenantName: signup.tenantName,
        verificationUrl: this.verificationUrl(token),
      });
    } catch (err) {
      // The request must be retryable from the landing page: remove the row if
      // delivery failed so the same email/slug is not blocked by a dead link.
      await this.prisma.signupRequest
        .delete({ where: { id: signup.id } })
        .catch(() => undefined);
      throw err;
    }

    return {
      signupId: signup.id,
      status: signup.status,
      email: ownerEmail,
      message:
        'Check your email for the verification link. It expires in 24 hours.',
    };
  }

  async verify(rawToken: string) {
    const token = String(rawToken || '').trim();
    if (!/^[0-9a-f]{64}$/i.test(token)) {
      throw new BadRequestException('Invalid verification token');
    }

    const signup = await this.prisma.signupRequest.findUnique({
      where: { verificationTokenHash: sha256(token.toLowerCase()) },
    });
    if (!signup) throw new NotFoundException('Verification link is not valid');

    if (signup.status === 'VERIFIED') {
      // Verification is idempotent. Resume provisioning if the earlier
      // trigger never created a job (e.g. the platform restarted between the
      // status update and the async provisioning call).
      void this.provisioning
        .startForSignup(signup.id)
        .catch(() => undefined);
      return {
        verified: true,
        alreadyVerified: true,
        slug: signup.slug,
        tenantName: signup.tenantName,
      };
    }

    if (signup.status === 'CANCELLED') {
      throw new GoneException('This signup was cancelled');
    }

    const expired =
      signup.status === 'EXPIRED' ||
      !signup.verificationExpiresAt ||
      signup.verificationExpiresAt.getTime() < Date.now();
    if (expired) {
      if (signup.status !== 'EXPIRED') {
        await this.prisma.signupRequest.update({
          where: { id: signup.id },
          data: { status: 'EXPIRED' },
        });
      }
      throw new GoneException(
        'This verification link has expired. Request a new one from the signup page.',
      );
    }

    await this.prisma.signupRequest.update({
      where: { id: signup.id },
      data: { status: 'VERIFIED', verifiedAt: new Date() },
    });

    // Provisioning is asynchronous; the verify response must not wait on the
    // tenant bootstrap. Failures are recorded on the job and are retryable.
    void this.provisioning
      .startForSignup(signup.id)
      .catch(() => undefined);

    return {
      verified: true,
      alreadyVerified: false,
      slug: signup.slug,
      tenantName: signup.tenantName,
    };
  }

  async status(rawToken: string) {
    const token = String(rawToken || '').trim();
    if (!/^[0-9a-f]{64}$/i.test(token)) {
      throw new BadRequestException('Invalid verification token');
    }
    const signup = await this.prisma.signupRequest.findUnique({
      where: { verificationTokenHash: sha256(token.toLowerCase()) },
    });
    if (!signup) throw new NotFoundException('Signup not found');

    const job = await this.prisma.provisioningJob.findUnique({
      where: { signupId: signup.id },
    });
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: signup.slug },
      select: { id: true, status: true },
    });

    return {
      status: signup.status,
      slug: signup.slug,
      tenantName: signup.tenantName,
      tenantStatus: tenant?.status ?? null,
      urls: tenant
        ? {
            admin: this.domainConfig.absoluteUrl(signup.slug, '/admin/'),
            storefront: this.domainConfig.absoluteUrl(signup.slug, '/'),
          }
        : null,
      provisioning: job
        ? { status: job.status, step: job.step, attempts: job.attempts }
        : null,
    };
  }

  async retryProvisioning(rawToken: string) {
    const token = String(rawToken || '').trim();
    if (!/^[0-9a-f]{64}$/i.test(token)) {
      throw new BadRequestException('Invalid verification token');
    }
    const tokenHash = sha256(token.toLowerCase());
    this.rateLimit.assert(`provision-retry:${tokenHash}`, 5, 60 * 60_000);

    const signup = await this.prisma.signupRequest.findUnique({
      where: { verificationTokenHash: tokenHash },
    });
    if (!signup) throw new NotFoundException('Signup not found');
    if (signup.status !== 'VERIFIED') {
      throw new BadRequestException('Verify your email before retrying setup');
    }

    const job = await this.prisma.provisioningJob.findUnique({
      where: { signupId: signup.id },
    });
    if (!job) {
      void this.provisioning.startForSignup(signup.id).catch(() => undefined);
      return {
        started: true,
        provisioning: null,
      };
    }
    if (job.status === 'SUCCEEDED' || job.status === 'RUNNING') {
      return {
        started: false,
        provisioning: {
          status: job.status,
          step: job.step,
          attempts: job.attempts,
        },
      };
    }

    void this.provisioning.retry(job.id).catch(() => undefined);
    return {
      started: true,
      provisioning: { status: 'PENDING', step: 'retrying', attempts: job.attempts },
    };
  }

  async resend(dto: ResendVerificationDto, meta: SignupRequestMeta = {}) {
    const ipKey = meta.ip || 'unknown';
    this.rateLimit.assert(`resend:ip:${ipKey}`, IP_LIMIT, RESEND_WINDOW_MS);
    this.assertHoneypot(dto.website);
    await this.assertCaptcha(dto.captchaToken, meta.ip);

    const ownerEmail = dto.email.trim().toLowerCase();
    this.rateLimit.assert(`resend:email:${ownerEmail}`, RESEND_LIMIT, RESEND_WINDOW_MS);
    await this.expireStale();

    const signup = await this.prisma.signupRequest.findFirst({
      where: { ownerEmail, status: 'PENDING_EMAIL' },
      orderBy: { createdAt: 'desc' },
    });

    // Always the same response: never reveal whether an address has a pending
    // signup.
    const message =
      'If a pending signup exists for this email, a new verification link has been sent.';

    if (!signup) return { message };

    const token = randomBytes(32).toString('hex');
    const previous = {
      verificationTokenHash: signup.verificationTokenHash,
      verificationExpiresAt: signup.verificationExpiresAt,
    };
    await this.prisma.signupRequest.update({
      where: { id: signup.id },
      data: {
        verificationTokenHash: sha256(token),
        verificationExpiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        status: 'PENDING_EMAIL',
      },
    });

    try {
      await this.mail.sendVerification({
        to: ownerEmail,
        tenantName: signup.tenantName,
        verificationUrl: this.verificationUrl(token),
      });
    } catch (err) {
      // Keep the previous link valid if the new email could not be sent.
      await this.prisma.signupRequest
        .update({ where: { id: signup.id }, data: previous })
        .catch(() => undefined);
      throw err;
    }

    return { message };
  }

  private verificationUrl(token: string): string {
    const base = (
      process.env.PLATFORM_LANDING_URL || 'http://localhost:3002'
    ).replace(/\/+$/, '');
    return `${base}/verify-email?token=${encodeURIComponent(token)}`;
  }

  private assertHoneypot(value?: string) {
    if (value && value.trim()) {
      throw new BadRequestException('Signup could not be completed');
    }
  }

  private async assertCaptcha(token?: string, ip?: string) {
    const ok = await this.captcha.verify(token, ip);
    if (!ok) {
      throw new BadRequestException(
        'Human verification failed. Please complete the challenge and try again.',
      );
    }
  }

  private async expireStale() {
    await this.prisma.signupRequest.updateMany({
      where: {
        status: 'PENDING_EMAIL',
        verificationExpiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });
  }

  private async assertAvailable(
    slug: string,
    ownerEmail: string,
    ownerPhone: string | null,
  ) {
    const phones = phoneVariants(ownerPhone);
    const [
      tenantSlug,
      tenantEmail,
      pendingSlug,
      pendingEmail,
      tenantPhone,
      pendingPhone,
    ] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { slug } }),
      this.prisma.tenant.findFirst({ where: { ownerEmail } }),
      this.prisma.signupRequest.findFirst({
        where: { slug, status: { in: ['PENDING_EMAIL', 'VERIFIED'] } },
      }),
      this.prisma.signupRequest.findFirst({
        where: {
          ownerEmail,
          status: { in: ['PENDING_EMAIL', 'VERIFIED'] },
        },
      }),
      phones.length > 0
        ? this.prisma.tenant.findFirst({
            where: { ownerPhone: { in: phones } },
          })
        : Promise.resolve(null),
      phones.length > 0
        ? this.prisma.signupRequest.findFirst({
            where: {
              ownerPhone: { in: phones },
              status: { in: ['PENDING_EMAIL', 'VERIFIED'] },
            },
          })
        : Promise.resolve(null),
    ]);

    if (tenantSlug || pendingSlug) {
      throw new ConflictException('This store address is already taken');
    }
    if (tenantEmail) {
      throw new ConflictException('This email is already registered');
    }
    if (pendingEmail) {
      throw new ConflictException(
        'A signup is already pending for this email. Resend the verification email.',
      );
    }
    if (tenantPhone || pendingPhone) {
      throw new ConflictException(
        'A trial is already registered for this phone number. Contact support if you need another store.',
      );
    }
  }
}
