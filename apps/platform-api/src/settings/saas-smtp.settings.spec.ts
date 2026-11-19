import { BadRequestException } from '@nestjs/common';
import { EncryptionService } from '../common/encryption.service';
import { SettingsService } from './settings.service';

/**
 * saas_smtp settings only (getSaasSmtp / updateSaasSmtp / loadAll parse).
 * Kept separate from settings.service.spec.ts — that file is shared
 * with the pricing worker.
 */

function buildService(stored: Record<string, unknown> = {}) {
  const prisma = {
    platformSetting: {
      findUnique: jest.fn(async ({ where }: any) => {
        const value = stored[where.key];
        return value === undefined ? null : { key: where.key, value };
      }),
      upsert: jest.fn(async ({ where, update }: any) => {
        stored[where.key] = update.value;
        return { key: where.key, value: update.value };
      }),
    },
  } as any;
  return {
    prisma,
    stored,
    service: new SettingsService(prisma, new EncryptionService()),
  };
}

describe('SettingsService — saas_smtp', () => {
  it('defaults to 10 free emails, no rate, no expiry', () => {
    const { service } = buildService();
    expect(service.getSaasSmtp()).toEqual({
      unit: 'PER_EMAIL',
      pricePerUnit: null,
      freeAllowance: 10,
      lowBalanceThreshold: 10,
      expiry: { mode: 'NONE', days: 90, warnDays: 7 },
    });
  });

  it('getSaasSmtp returns a deep copy (callers cannot mutate the cache)', () => {
    const { service } = buildService();
    const first = service.getSaasSmtp();
    first.freeAllowance = 99;
    first.expiry.mode = 'FIXED_DAYS';
    expect(service.getSaasSmtp().freeAllowance).toBe(10);
    expect(service.getSaasSmtp().expiry.mode).toBe('NONE');
  });

  it('updateSaasSmtp persists the rate + expiry and returns the new row', async () => {
    const { service, stored } = buildService();
    const next = await service.updateSaasSmtp({
      unit: 'PER_1000',
      pricePerUnit: 500,
      freeAllowance: 20,
      lowBalanceThreshold: 5,
      expiry: { mode: 'FIXED_DAYS', days: 30, warnDays: 3 },
    });
    expect(next).toEqual({
      unit: 'PER_1000',
      pricePerUnit: 500,
      freeAllowance: 20,
      lowBalanceThreshold: 5,
      expiry: { mode: 'FIXED_DAYS', days: 30, warnDays: 3 },
    });
    expect(stored.saas_smtp).toEqual(next);
    expect(service.getSaasSmtp()).toEqual(next);
  });

  it('updateSaasSmtp is a partial update: omitted fields keep their value', async () => {
    const { service } = buildService();
    await service.updateSaasSmtp({ unit: 'PER_1000', pricePerUnit: 500 });
    const next = await service.updateSaasSmtp({ freeAllowance: 15 });
    expect(next.unit).toBe('PER_1000');
    expect(next.pricePerUnit).toBe(500);
    expect(next.freeAllowance).toBe(15);
  });

  it('an explicit null pricePerUnit clears the rate (top-ups disabled)', async () => {
    const { service } = buildService();
    await service.updateSaasSmtp({ pricePerUnit: 0.5 });
    expect(service.getSaasSmtp().pricePerUnit).toBe(0.5);
    const next = await service.updateSaasSmtp({ pricePerUnit: null });
    expect(next.pricePerUnit).toBeNull();
  });

  it('rejects freeAllowance above the Q11 max of 20', async () => {
    const { service } = buildService();
    await expect(service.updateSaasSmtp({ freeAllowance: 21 })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.updateSaasSmtp({ freeAllowance: -1 })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.updateSaasSmtp({ freeAllowance: 10.5 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an invalid unit, negative price, or bad expiry', async () => {
    const { service } = buildService();
    await expect(service.updateSaasSmtp({ unit: 'PER_DAY' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.updateSaasSmtp({ pricePerUnit: -1 })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.updateSaasSmtp({ expiry: { mode: 'WEEKLY' } }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateSaasSmtp({ expiry: { days: 0 } }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateSaasSmtp({ expiry: { warnDays: -1 } }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateSaasSmtp({ lowBalanceThreshold: -1 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('loadAll parses a stored saas_smtp row defensively', async () => {
    const { service } = buildService({
      saas_smtp: {
        unit: 'PER_1000',
        pricePerUnit: 500,
        freeAllowance: 99, // clamped to the 20 max
        lowBalanceThreshold: 5,
        expiry: { mode: 'END_OF_PERIOD', days: 0, warnDays: 3 },
      },
    });
    await service.onModuleInit();
    expect(service.getSaasSmtp()).toEqual({
      unit: 'PER_1000',
      pricePerUnit: 500,
      freeAllowance: 20,
      lowBalanceThreshold: 5,
      expiry: { mode: 'END_OF_PERIOD', days: 1, warnDays: 3 },
    });
  });

  it('loadAll falls back to defaults on a malformed row', async () => {
    const { service } = buildService({ saas_smtp: 'not-an-object' });
    await service.onModuleInit();
    expect(service.getSaasSmtp().freeAllowance).toBe(10);
    expect(service.getSaasSmtp().pricePerUnit).toBeNull();
  });
});
