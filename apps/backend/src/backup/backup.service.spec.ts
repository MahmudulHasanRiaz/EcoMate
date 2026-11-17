import { execFile } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BackupService } from './backup.service';

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return { ...actual, execFile: jest.fn() };
});
const mockedExecFile = execFile as unknown as jest.Mock;

function makeService(overrides: {
  settings?: Record<string, string>;
  alerts?: { sendAlert: jest.Mock };
  backupQueue?: Record<string, jest.Mock>;
}) {
  const settings = overrides.settings ?? {};
  const prisma = {
    systemSetting: {
      findFirst: jest.fn(async ({ where }: { where: { key: string } }) =>
        settings[where.key] !== undefined
          ? { key: where.key, value: settings[where.key] }
          : null,
      ),
    },
    backupJob: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  } as any;
  const backupQueue = {
    add: jest.fn().mockResolvedValue({ repeatJobKey: 'new-key' }),
    getRepeatableJobs: jest.fn().mockResolvedValue([]),
    removeRepeatableByKey: jest.fn().mockResolvedValue(true),
    ...overrides.backupQueue,
  } as any;
  const alerts = overrides.alerts ?? {
    sendAlert: jest.fn().mockResolvedValue({ sent: true }),
  };
  const service = new BackupService(
    prisma,
    {} as any,
    {} as any,
    {} as any,
    backupQueue,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    alerts as any,
  );
  return { service, prisma, backupQueue, alerts };
}

describe('BackupService — Phase 8 Stage 2 item 22 (scheduled defaults)', () => {
  it('registers a daily db_files schedule when no settings exist', async () => {
    const { service, backupQueue } = makeService({});
    await (service as any).reregisterRepeatableJob();

    expect(backupQueue.add).toHaveBeenCalledTimes(1);
    expect(backupQueue.add).toHaveBeenCalledWith(
      'scheduled-backup',
      { scope: 'db_files', type: 'scheduled' },
      expect.objectContaining({
        repeat: expect.objectContaining({
          pattern: '0 2 * * *',
          tz: 'Asia/Dhaka',
        }),
      }),
    );
    expect(backupQueue.removeRepeatableByKey).not.toHaveBeenCalled();
  });

  it('respects an explicit opt-out (backup_schedule_enabled=false)', async () => {
    const { service, backupQueue } = makeService({
      settings: { backup_schedule_enabled: 'false' },
      backupQueue: {
        getRepeatableJobs: jest.fn().mockResolvedValue([
          { name: 'scheduled-backup', key: 'old-key' },
        ]),
      },
    });
    await (service as any).reregisterRepeatableJob();

    expect(backupQueue.add).not.toHaveBeenCalled();
    expect(backupQueue.removeRepeatableByKey).toHaveBeenCalledWith('old-key');
  });

  it('respects an explicit db_only scope choice', async () => {
    const { service, backupQueue } = makeService({
      settings: { backup_default_scope: 'db_only' },
    });
    await (service as any).reregisterRepeatableJob();

    expect(backupQueue.add).toHaveBeenCalledWith(
      'scheduled-backup',
      { scope: 'db_only', type: 'scheduled' },
      expect.anything(),
    );
  });

  it('respects a custom cron expression', async () => {
    const { service, backupQueue } = makeService({
      settings: { backup_schedule_cron: '0 3 * * 0' },
    });
    await (service as any).reregisterRepeatableJob();
    expect(backupQueue.add).toHaveBeenCalledWith(
      'scheduled-backup',
      { scope: 'db_files', type: 'scheduled' },
      expect.objectContaining({
        repeat: expect.objectContaining({ pattern: '0 3 * * 0' }),
      }),
    );
  });
});

describe('BackupService — Phase 8 Stage 2 item 22 (platform dump)', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('skips the platform dump (with a warning, not a failure) when PLATFORM_DATABASE_URL is unset', async () => {
    delete process.env.PLATFORM_DATABASE_URL;
    const { service } = makeService({});
    const result = await (service as any).createPlatformDbDump('/tmp');
    expect(result).toBeNull();
  });
});

describe('BackupService — Phase 8 Stage 2 item 22/23 (pg_dump must stay self-contained)', () => {
  it('dumps without --schema so CREATE EXTENSION survives (restore drops public CASCADE)', async () => {
    // Regression test for the 2026-11-17 restore drill: with --schema=public,
    // pg_dump emits NO CREATE EXTENSION lines, so after the restore's
    // DROP SCHEMA public CASCADE (which drops pg_trgm) the replay dies at
    // the first trigram index: 'operator class "public.gin_trgm_ops" does
    // not exist'. The dump must stay self-contained.
    const workDir = mkdtempSync(join(tmpdir(), 'p8d-dump-args-'));
    try {
      mockedExecFile.mockImplementationOnce(
        (file: string, args: string[], _options: unknown, cb: any) => {
          const fileIdx = args.indexOf('--file');
          writeFileSync(args[fileIdx + 1], '-- fake dump\n');
          cb(null, { stdout: '', stderr: '' });
          return undefined as any;
        },
      );
      const { service } = makeService({});
      const { dumpPath } = await (service as any).dumpDatabase(
        'postgresql://u:p@127.0.0.1:55432/some_db',
        workDir,
        'dump.sql',
        'tenant',
      );
      expect(dumpPath).toBe(join(workDir, 'dump.sql'));
      expect(mockedExecFile).toHaveBeenCalledTimes(1);
      const [, args] = mockedExecFile.mock.calls[0];
      expect(args).toContain('--exclude-schema=ecomate_control');
      expect(args).toContain('--clean');
      expect(args).toContain('--if-exists');
      expect(args).not.toContain('--schema=public');
      expect(args.filter((a: string) => a.startsWith('--schema='))).toEqual(
        [],
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

describe('BackupService — Phase 8 Stage 2 item 23 (re-grant after restore)', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    mockedExecFile.mockClear();
    mockedExecFile.mockImplementation(
      (_file: string, _args: string[], _options: unknown, cb: any) => {
        cb(null, { stdout: '', stderr: '' });
        return undefined as any;
      },
    );
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('re-applies the tenant app role grants after the replay', async () => {
    // Regression test for the 2026-11-17 restore drill: the replay drops
    // public CASCADE and the dump carries no GRANTs (--no-acl), so without
    // a re-grant the tenant role gets 'permission denied for schema public'
    // on the first post-restore query.
    process.env.DATABASE_URL =
      'postgresql://postgres@127.0.0.1:55432/ecomate_tenant_test';
    process.env.TENANT_DATABASE_URL =
      'postgresql://ecomate_tenant_app@127.0.0.1:55432/ecomate_tenant_test';
    const { service } = makeService({});
    await (service as any).regrantTenantAppRole();

    expect(mockedExecFile).toHaveBeenCalledTimes(1);
    const [file, args] = mockedExecFile.mock.calls[0];
    expect(file).toBe('psql');
    const command = args[args.indexOf('--command') + 1] as string;
    expect(command).toContain('GRANT USAGE ON SCHEMA public TO "ecomate_tenant_app"');
    expect(command).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "ecomate_tenant_app"',
    );
    expect(command).toContain(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "ecomate_tenant_app"',
    );
    expect(command).toContain(
      'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "ecomate_tenant_app"',
    );
    expect(command).toContain('GRANT USAGE ON SCHEMA "ecomate_control"');
    expect(command).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ecomate_control"."backup_restore_operation"',
    );
    // The re-grant runs as the DATABASE_URL (superuser) role, not the tenant role.
    expect(args[args.indexOf('--username') + 1]).toBe('postgres');
  });

  it('is a no-op when the tenant role is the same as the control role', async () => {
    process.env.DATABASE_URL =
      'postgresql://postgres@127.0.0.1:55432/ecomate_tenant_test';
    process.env.TENANT_DATABASE_URL =
      'postgresql://postgres@127.0.0.1:55432/ecomate_tenant_test';
    const { service } = makeService({});
    await (service as any).regrantTenantAppRole();
    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it('is a no-op when TENANT_DATABASE_URL is unset', async () => {
    process.env.DATABASE_URL =
      'postgresql://postgres@127.0.0.1:55432/ecomate_tenant_test';
    delete process.env.TENANT_DATABASE_URL;
    const { service } = makeService({});
    await (service as any).regrantTenantAppRole();
    expect(mockedExecFile).not.toHaveBeenCalled();
  });
});

describe('BackupService — Phase 8 Stage 2 item 20 (failure alerts)', () => {
  it('alerts ops when a restore fails', async () => {
    const { service, alerts, prisma } = makeService({});
    await (service as any).handleRestoreFailure(
      { id: 'backup-1', type: 'scheduled', scope: 'db_files' },
      new Error('psql exited 1'),
      true,
    );

    expect(prisma.backupJob.upsert).toHaveBeenCalled();
    expect(alerts.sendAlert).toHaveBeenCalledTimes(1);
    expect(alerts.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'restore-failure',
        subject: expect.stringContaining('backup-1'),
      }),
    );
  });

  it('still marks the failure when no alerts service is wired (older specs)', async () => {
    const { service, prisma } = makeService({});
    const bare = new BackupService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(
      (bare as any).handleRestoreFailure(
        { id: 'backup-1', type: 'scheduled', scope: 'db_files' },
        new Error('psql exited 1'),
        false,
      ),
    ).resolves.not.toThrow();
    expect(prisma.backupJob.upsert).toHaveBeenCalled();
    expect(service).toBeTruthy();
  });
});
