import { Queue } from 'bullmq';
import {
  BULL_BOARD_BASE_PATH,
  isSuperadminRequest,
  registerBullBoard,
} from './bull-board.setup';

function requestWith(auth?: string) {
  return { headers: auth ? { authorization: auth } : {} } as any;
}

describe('isSuperadminRequest (Bull Board guard)', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, JWT_SECRET: 'test-secret' };
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('rejects requests without a bearer token', async () => {
    const jwt = { verifyAsync: jest.fn() } as any;
    await expect(isSuperadminRequest(requestWith(), jwt)).resolves.toBe(
      false,
    );
    await expect(
      isSuperadminRequest(requestWith('Basic abc'), jwt),
    ).resolves.toBe(false);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('accepts a valid superadmin token', async () => {
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({ role: 'superadmin' }),
    } as any;
    await expect(
      isSuperadminRequest(requestWith('Bearer good-token'), jwt),
    ).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('good-token', {
      secret: 'test-secret',
    });
  });

  it('rejects non-superadmin roles', async () => {
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({ role: 'admin' }),
    } as any;
    await expect(
      isSuperadminRequest(requestWith('Bearer t'), jwt),
    ).resolves.toBe(false);
  });

  it('rejects impersonated tokens even with a superadmin role', async () => {
    const jwt = {
      verifyAsync: jest
        .fn()
        .mockResolvedValue({ role: 'superadmin', imp: true }),
    } as any;
    await expect(
      isSuperadminRequest(requestWith('Bearer t'), jwt),
    ).resolves.toBe(false);
  });

  it('rejects invalid/expired tokens', async () => {
    const jwt = {
      verifyAsync: jest.fn().mockRejectedValue(new Error('jwt expired')),
    } as any;
    await expect(
      isSuperadminRequest(requestWith('Bearer t'), jwt),
    ).resolves.toBe(false);
  });

  it('fails closed when JWT_SECRET is unset', async () => {
    delete process.env.JWT_SECRET;
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({ role: 'superadmin' }),
    } as any;
    await expect(
      isSuperadminRequest(requestWith('Bearer t'), jwt),
    ).resolves.toBe(false);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });
});

describe('registerBullBoard (mounting)', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.BULL_BOARD_ENABLED;
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('registers the board plugin WITH the /api/admin/queues prefix', async () => {
    // BullMQAdapter validates its queue is a real BullMQ Queue, so use
    // one pointed at the test Redis (no jobs are created; it is closed
    // after the mount).
    const realQueue = new Queue('p8d-bull-board-test', {
      connection: { host: '127.0.0.1', port: 6379 },
    });
    try {
      const innerRegister = jest.fn().mockResolvedValue(undefined);
    const mockInstance = {
      addHook: jest.fn(),
      register: innerRegister,
    };
    const outerRegister = jest.fn(async (plugin: (i: any) => Promise<void>) => {
      await plugin(mockInstance);
    });
    const fakeQueue = realQueue;
    const app = {
      get: jest.fn((token: unknown) => {
        if (typeof token === 'string' && token.startsWith('BullQueue_')) {
          return fakeQueue;
        }
        // JwtService (a class token)
        return { verifyAsync: jest.fn() };
      }),
      getHttpAdapter: () => ({ getInstance: () => ({ register: outerRegister }) }),
    } as any;

    const mounted = await registerBullBoard(app);

    expect(mounted).toBe(true);
    expect(outerRegister).toHaveBeenCalledTimes(1);
    expect(innerRegister).toHaveBeenCalledTimes(1);
    // The prefix is load-bearing: without it the board mounts at the app
    // root (entry route `/`, API `/api/queues`) instead of the guarded
    // /api/admin/queues path. Found live 2026-11-17 (404 on every board
    // URL while the log claimed "mounted").
    expect(innerRegister).toHaveBeenCalledWith(
      expect.any(Function),
      { prefix: BULL_BOARD_BASE_PATH },
    );
    expect(BULL_BOARD_BASE_PATH).toBe('/api/admin/queues');
    } finally {
      await realQueue.close();
    }
  });

  it('returns false when disabled', async () => {
    process.env.BULL_BOARD_ENABLED = 'false';
    const app = { get: jest.fn(), getHttpAdapter: jest.fn() } as any;
    await expect(registerBullBoard(app)).resolves.toBe(false);
  });
});
