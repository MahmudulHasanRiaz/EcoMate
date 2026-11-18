import { SettingsService } from '../settings.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    userSettings: {
      findFirst: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      ...(overrides.userSettings as Record<string, unknown>),
    },
    userProfile: {
      findFirst: jest.fn(),
      ...(overrides.userProfile as Record<string, unknown>),
    },
  };
}

const EMPTY_SETTINGS = {
  id: 's1',
  userId: 'u1',
  username: null,
  email: null,
  bio: null,
  urls: null,
  accountName: null,
  accountDob: null,
  accountLanguage: null,
  theme: 'light',
  font: 'inter',
  notificationType: 'all',
  notificationMobile: false,
  notificationCommunicationEmail: false,
  notificationSocialEmail: false,
  notificationMarketingEmail: false,
  notificationSecurityEmail: true,
  displayItems: null,
};

describe('SettingsService.getSettings (R-PROFILE)', () => {
  it('falls back to the account username/email when UserSettings is empty', async () => {
    const prisma = makePrisma({
      userSettings: { findFirst: jest.fn().mockResolvedValue(EMPTY_SETTINGS) },
      userProfile: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ username: 'mahmudriaz-bd', email: 'op@example.com' }),
      },
    });
    const service = new SettingsService(prisma as never);
    const result = await service.getSettings('u1');
    expect(result.profile.username).toBe('mahmudriaz-bd');
    expect(result.profile.email).toBe('op@example.com');
    // Bio has no account-level source and stays empty until set.
    expect(result.profile.bio).toBeNull();
  });

  it('prefers an explicitly saved UserSettings value over the account', async () => {
    const prisma = makePrisma({
      userSettings: {
        findFirst: jest.fn().mockResolvedValue({
          ...EMPTY_SETTINGS,
          username: 'saved-name',
          email: 'saved@example.com',
          bio: 'hello',
        }),
      },
      userProfile: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ username: 'account-name', email: 'account@example.com' }),
      },
    });
    const service = new SettingsService(prisma as never);
    const result = await service.getSettings('u1');
    expect(result.profile.username).toBe('saved-name');
    expect(result.profile.email).toBe('saved@example.com');
    expect(result.profile.bio).toBe('hello');
  });

  it('falls back per-field when only one value is saved', async () => {
    const prisma = makePrisma({
      userSettings: {
        findFirst: jest.fn().mockResolvedValue({ ...EMPTY_SETTINGS, username: 'saved-name' }),
      },
      userProfile: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ username: 'account-name', email: 'account@example.com' }),
      },
    });
    const service = new SettingsService(prisma as never);
    const result = await service.getSettings('u1');
    expect(result.profile.username).toBe('saved-name');
    expect(result.profile.email).toBe('account@example.com');
  });

  it('returns nulls when neither UserSettings nor the account has a value', async () => {
    const prisma = makePrisma({
      userSettings: { findFirst: jest.fn().mockResolvedValue(EMPTY_SETTINGS) },
      userProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const service = new SettingsService(prisma as never);
    const result = await service.getSettings('u1');
    expect(result.profile.username).toBeNull();
    expect(result.profile.email).toBeNull();
  });

  it('creates the UserSettings row on first access, then applies the fallback', async () => {
    const prisma = makePrisma({
      userSettings: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(EMPTY_SETTINGS),
      },
      userProfile: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ username: 'fresh-user', email: 'fresh@example.com' }),
      },
    });
    const service = new SettingsService(prisma as never);
    const result = await service.getSettings('u1');
    expect(prisma.userSettings.create).toHaveBeenCalledWith({
      data: { userId: 'u1' },
    });
    expect(result.profile.username).toBe('fresh-user');
    expect(result.profile.email).toBe('fresh@example.com');
  });
});
