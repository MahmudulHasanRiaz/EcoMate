import * as crypto from 'crypto';
import {
  hashContact,
  sha256Hex,
  toUnixSeconds,
  type AdLeadContext,
} from './ad-sender';
import {
  buildMetaCapiPayload,
  MetaCapiSender,
} from './meta-capi.sender';
import { StubAdSender } from './stub.sender';
import {
  buildTikTokEventsPayload,
  TikTokEventsSender,
} from './tiktok-events.sender';

/**
 * Sender specs: payload shape for the real Meta CAPI + TikTok Events
 * API senders (correct-shaped, never exercised against real accounts
 * here), the shared hashing helpers, and the stub sender.
 */

function makeContext(overrides: Partial<AdLeadContext> = {}): AdLeadContext {
  return {
    platform: 'meta',
    lead: {
      id: 'lead-1',
      name: 'Test Lead',
      contact: 'Lead@Example.COM',
      contactType: 'email',
      fbp: 'fb.1.1700000000.123456',
      fbc: 'fb.1.1700000000.AbCdEf',
      eventId: 'evt-meta-1',
      ttclid: 'ttclid-1',
      tiktokEventId: 'evt-tiktok-1',
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (test)',
      createdAt: new Date('2026-11-19T10:00:00.000Z'),
    },
    dispatch: {
      id: 'dispatch-1',
      eventName: 'Lead',
      createdAt: new Date('2026-11-19T10:00:00.000Z'),
    },
    config: { pixelId: '123456789', accessToken: 'test-token' },
    ...overrides,
  };
}

function mockFetchOnce(status: number, body: unknown) {
  return jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as any);
}

describe('hashing helpers', () => {
  it('sha256Hex hashes utf8', () => {
    expect(sha256Hex('abc')).toBe(
      crypto.createHash('sha256').update('abc').digest('hex'),
    );
  });

  it('hashContact lowercases + trims an email before hashing', () => {
    const { email, phone } = hashContact('  Lead@Example.COM ', 'email');
    expect(email).toBe(sha256Hex('lead@example.com'));
    expect(phone).toBeUndefined();
  });

  it('hashContact drops a malformed email', () => {
    expect(hashContact('not-an-email', 'email')).toEqual({});
  });

  it('hashContact normalizes a Bangladeshi 0-prefixed phone to 880', () => {
    const { phone } = hashContact('01712-345 678', 'phone');
    expect(phone).toBe(sha256Hex('8801712345678'));
  });

  it('hashContact keeps an already-coded phone and drops short ones', () => {
    expect(hashContact('+8801712345678', 'phone').phone).toBe(
      sha256Hex('8801712345678'),
    );
    expect(hashContact('123', 'phone')).toEqual({});
    expect(hashContact('no digits', 'phone')).toEqual({});
  });

  it('toUnixSeconds truncates to seconds', () => {
    expect(toUnixSeconds(new Date('2026-11-19T10:00:00.900Z'))).toBe(
      Math.floor(new Date('2026-11-19T10:00:00.900Z').getTime() / 1000),
    );
  });
});

describe('Meta CAPI sender', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds a correct-shaped Conversions API payload', () => {
    const { url, body } = buildMetaCapiPayload(makeContext());
    expect(url).toBe(
      'https://graph.facebook.com/v21.0/123456789/events?access_token=test-token',
    );
    const event = (body as any).data[0];
    expect(event.event_name).toBe('Lead');
    expect(event.event_time).toBe(1795082400);
    expect(event.event_id).toBe('evt-meta-1');
    expect(event.action_source).toBe('website');
    expect(event.user_data.em).toBe(sha256Hex('lead@example.com'));
    expect(event.user_data.fbp).toBe('fb.1.1700000000.123456');
    expect(event.user_data.fbc).toBe('fb.1.1700000000.AbCdEf');
    expect(event.user_data.client_ip_address).toBe('203.0.113.7');
    expect(event.user_data.client_user_agent).toBe('Mozilla/5.0 (test)');
    expect(event.custom_data).toEqual({ lead_id: 'lead-1' });
    expect(event.event_source_url).toBeUndefined();
  });

  it('falls back to the dispatch id when the form sent no eventId', () => {
    const ctx = makeContext();
    ctx.lead.eventId = null;
    const { body } = buildMetaCapiPayload(ctx);
    expect((body as any).data[0].event_id).toBe('dispatch-1');
  });

  it('omits absent user-data fields and includes the source URL when set', () => {
    const ctx = makeContext({
      eventSourceUrl: 'https://www.ecomate.bd/',
    });
    ctx.lead.fbp = null;
    ctx.lead.fbc = null;
    ctx.lead.ip = null;
    ctx.lead.userAgent = null;
    const { body } = buildMetaCapiPayload(ctx);
    const event = (body as any).data[0];
    expect(event.user_data).toEqual({
      em: sha256Hex('lead@example.com'),
    });
    expect(event.event_source_url).toBe('https://www.ecomate.bd/');
  });

  it('sends a phone lead as hashed ph (no em)', () => {
    const ctx = makeContext();
    ctx.lead.contact = '01712345678';
    ctx.lead.contactType = 'phone';
    const { body } = buildMetaCapiPayload(ctx);
    const userData = (body as any).data[0].user_data;
    expect(userData.em).toBeUndefined();
    expect(userData.ph).toBe(sha256Hex('8801712345678'));
  });

  it('resolves on a 2xx success payload', async () => {
    mockFetchOnce(200, { events_received: 1 });
    await expect(new MetaCapiSender().send(makeContext())).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('graph.facebook.com/v21.0/123456789/events'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on a non-2xx Meta error (message + code surfaced)', async () => {
    mockFetchOnce(400, {
      error: { message: 'Invalid OAuth access token', code: 190 },
    });
    await expect(new MetaCapiSender().send(makeContext())).rejects.toThrow(
      'Meta CAPI 400: Invalid OAuth access token (code 190)',
    );
  });

  it('throws on a 2xx carrying an error payload', async () => {
    mockFetchOnce(200, { error: { message: 'partial failure' } });
    await expect(new MetaCapiSender().send(makeContext())).rejects.toThrow(
      'Meta CAPI error: partial failure',
    );
  });
});

describe('TikTok Events API sender', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds a correct-shaped Events API payload', () => {
    const ctx = makeContext({
      platform: 'tiktok',
      dispatch: {
        id: 'dispatch-1',
        eventName: 'SubmitForm',
        createdAt: new Date('2026-11-19T10:00:00.000Z'),
      },
      config: { pixelId: 'CTIKTOKPIXEL', accessToken: 'tt-token' },
    });
    const { url, body } = buildTikTokEventsPayload(ctx);
    expect(url).toBe(
      'https://business-api.tiktok.com/open_api/v1.3/event/track/',
    );
    expect(body).toMatchObject({
      pixel_code: 'CTIKTOKPIXEL',
      event: 'SubmitForm',
      event_id: 'evt-tiktok-1',
      event_time: 1795082400,
      user: {
        email: sha256Hex('lead@example.com'),
        ttclid: 'ttclid-1',
      },
      properties: { lead_id: 'lead-1' },
    });
  });

  it('falls back to the dispatch id when the form sent no tiktokEventId', () => {
    const ctx = makeContext({ platform: 'tiktok' });
    ctx.lead.tiktokEventId = null;
    const { body } = buildTikTokEventsPayload(ctx);
    expect((body as any).event_id).toBe('dispatch-1');
  });

  it('includes the page URL when an event source URL is set', () => {
    const ctx = makeContext({
      platform: 'tiktok',
      eventSourceUrl: 'https://www.ecomate.bd/',
    });
    const { body } = buildTikTokEventsPayload(ctx);
    expect((body as any).page).toEqual({ url: 'https://www.ecomate.bd/' });
  });

  it('resolves on code 0 and sends the Access-Token header', async () => {
    mockFetchOnce(200, { code: 0, message: 'success' });
    await expect(
      new TikTokEventsSender().send(makeContext({ platform: 'tiktok' })),
    ).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://business-api.tiktok.com/open_api/v1.3/event/track/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Access-Token': 'test-token' }),
      }),
    );
  });

  it('throws on a non-zero code', async () => {
    mockFetchOnce(200, { code: 40001, message: 'invalid access token' });
    await expect(
      new TikTokEventsSender().send(makeContext({ platform: 'tiktok' })),
    ).rejects.toThrow(
      'TikTok Events API error: invalid access token (code 40001)',
    );
  });

  it('throws on a non-2xx response', async () => {
    mockFetchOnce(401, { code: 401, message: 'unauthorized' });
    await expect(
      new TikTokEventsSender().send(makeContext({ platform: 'tiktok' })),
    ).rejects.toThrow('TikTok Events API 401: unauthorized (code 401)');
  });
});

describe('StubAdSender', () => {
  it('records sends with the platform-specific dedup id', async () => {
    const stub = new StubAdSender();
    await stub.send(makeContext({ platform: 'meta' }));
    await stub.send(makeContext({ platform: 'tiktok' }));
    expect(stub.sent).toEqual([
      expect.objectContaining({
        platform: 'meta',
        eventId: 'evt-meta-1',
        hashedEmail: sha256Hex('lead@example.com'),
      }),
      expect.objectContaining({
        platform: 'tiktok',
        eventId: 'evt-tiktok-1',
      }),
    ]);
  });

  it('fails the first N sends, then succeeds', async () => {
    const stub = new StubAdSender(2);
    await expect(stub.send(makeContext())).rejects.toThrow(
      'stub send failure (injected)',
    );
    await expect(stub.send(makeContext())).rejects.toThrow(
      'stub send failure (injected)',
    );
    await expect(stub.send(makeContext())).resolves.toBeUndefined();
    expect(stub.sent).toHaveLength(1);
    expect(stub.failuresLeft).toBe(0);
  });

  it('reset clears the record and the failure count', async () => {
    const stub = new StubAdSender(3);
    await stub.send(makeContext()).catch(() => undefined);
    stub.reset();
    expect(stub.sent).toHaveLength(0);
    expect(stub.failuresLeft).toBe(0);
    await expect(stub.send(makeContext())).resolves.toBeUndefined();
  });
});
