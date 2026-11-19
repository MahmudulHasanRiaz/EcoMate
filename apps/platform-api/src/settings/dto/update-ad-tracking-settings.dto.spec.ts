import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateAdTrackingSettingsDto } from './update-ad-tracking-settings.dto';

function validDto(
  overrides: Record<string, unknown> = {},
): UpdateAdTrackingSettingsDto {
  return plainToInstance(UpdateAdTrackingSettingsDto, {
    pixelId: '123456789',
    accessToken: 'secret-token',
    mode: 'instant',
    triggerStatus: 'QUALIFIED',
    eventName: 'Lead',
    enabled: true,
    ...overrides,
  });
}

describe('UpdateAdTrackingSettingsDto', () => {
  it('accepts a full valid update', async () => {
    expect(await validate(validDto())).toEqual([]);
  });

  it('accepts an empty (partial) update', async () => {
    expect(
      await validate(plainToInstance(UpdateAdTrackingSettingsDto, {})),
    ).toEqual([]);
  });

  it('accepts an empty-string token (clear) and a blank event name', async () => {
    expect(
      await validate(validDto({ accessToken: '', eventName: '' })),
    ).toEqual([]);
  });

  it('rejects a bad mode', async () => {
    const errors = await validate(validDto({ mode: 'realtime' }));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('mode');
  });

  it('rejects a trigger status that is not a lead status', async () => {
    const errors = await validate(validDto({ triggerStatus: 'HOT' }));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('triggerStatus');
  });

  it('rejects overlong pixelId, token, and eventName', async () => {
    const errors = await validate(
      validDto({
        pixelId: 'x'.repeat(101),
        accessToken: 'x'.repeat(501),
        eventName: 'x'.repeat(101),
      }),
    );
    expect(errors.map((e) => e.property).sort()).toEqual([
      'accessToken',
      'eventName',
      'pixelId',
    ]);
  });

  it('rejects a non-boolean enabled', async () => {
    const errors = await validate(validDto({ enabled: 'yes' }));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('enabled');
  });
});
