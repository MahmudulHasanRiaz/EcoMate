import { HealthController } from './health.controller';

function fakeReply() {
  const reply: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return reply;
}

describe('HealthController', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function makeController(overrides: {
    dbOk?: boolean;
    redisPing?: boolean;
    queues?: { ok: boolean; queues: { name: string; ok: boolean; failed: number }[] };
  } = {}) {
    const prisma = {
      $queryRawUnsafe: overrides.dbOk === false
        ? jest.fn().mockRejectedValue(new Error('db down'))
        : jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    const cache = {
      ping: jest.fn().mockResolvedValue(overrides.redisPing ?? true),
    };
    const queues = {
      check: jest
        .fn()
        .mockResolvedValue(
          overrides.queues ?? { ok: true, queues: [{ name: 'email', ok: true, failed: 0 }] },
        ),
    };
    return {
      controller: new HealthController(prisma as any, cache as any, queues as any),
      prisma,
      cache,
      queues,
    };
  }

  it('live() never touches a dependency', async () => {
    const { controller, prisma, cache, queues } = makeController({
      dbOk: false,
      redisPing: false,
      queues: { ok: false, queues: [] },
    });
    const body = controller.live();
    expect(body.status).toBe('ok');
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(cache.ping).not.toHaveBeenCalled();
    expect(queues.check).not.toHaveBeenCalled();
  });

  it('ready() returns 200 with all checks green', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const { controller } = makeController();
    const res = fakeReply();
    await controller.ready(res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.database).toBe('ok');
    expect(res.body.checks.redis).toBe('ok');
    expect(res.body.checks.queues).toEqual([
      { name: 'email', ok: true, failed: 0 },
    ]);
  });

  it('ready() returns 503 when the database is down', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const { controller } = makeController({ dbOk: false });
    const res = fakeReply();
    await controller.ready(res as any);
    expect(res.statusCode).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.checks.database).toBe('failed');
  });

  it('ready() returns 503 when a configured Redis is down', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const { controller } = makeController({ redisPing: false });
    const res = fakeReply();
    await controller.ready(res as any);
    expect(res.statusCode).toBe(503);
    expect(res.body.checks.redis).toBe('failed');
  });

  it('ready() stays 200 when Redis is unconfigured (memory fallback)', async () => {
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    const { controller } = makeController({ redisPing: false });
    const res = fakeReply();
    await controller.ready(res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body.checks.redis).toBe('unconfigured');
  });

  it('ready() returns 503 when a queue check fails', async () => {
    const { controller } = makeController({
      queues: {
        ok: false,
        queues: [
          { name: 'email', ok: true, failed: 3 },
          { name: 'backup', ok: false, failed: 0 },
        ],
      },
    });
    const res = fakeReply();
    await controller.ready(res as any);
    expect(res.statusCode).toBe(503);
    expect(res.body.status).toBe('not_ready');
  });

  it('ready() stays 200 when queues have failed jobs (ops signal, not readiness)', async () => {
    const { controller } = makeController({
      queues: {
        ok: true,
        queues: [{ name: 'email', ok: true, failed: 12 }],
      },
    });
    const res = fakeReply();
    await controller.ready(res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body.checks.queues[0].failed).toBe(12);
  });

  it('check() keeps the aggregate shape and reports degraded on failure', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const { controller } = makeController({ dbOk: false });
    const body = await controller.check();
    expect(body.status).toBe('degraded');
    expect(body.checks.database).toBe('failed');
    expect(body.checks.redis).toBe('ok');
    expect(body.checks.memory).toMatch(/MB$/);
  });

  it('check() reports healthy when everything is green', async () => {
    const { controller } = makeController();
    const body = await controller.check();
    expect(body.status).toBe('healthy');
  });
});
