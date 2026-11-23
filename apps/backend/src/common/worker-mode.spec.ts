/**
 * Unit tests for the WORKER_MODE parsing + gating predicates
 * (worker split, workstream E). Pure functions — no DB, no Redis.
 */
import {
  parseWorkerMode,
  processorsEnabled,
  schedulersEnabled,
  httpEnabled,
  WORKER_MODE_DEFAULT,
  type WorkerMode,
} from './worker-mode';

describe('parseWorkerMode', () => {
  it('defaults to all when unset', () => {
    expect(parseWorkerMode({})).toBe('all');
    expect(WORKER_MODE_DEFAULT).toBe('all');
  });

  it('defaults to all when empty or blank', () => {
    expect(parseWorkerMode({ WORKER_MODE: '' })).toBe('all');
    expect(parseWorkerMode({ WORKER_MODE: '   ' })).toBe('all');
  });

  it.each(['all', 'api', 'worker'] as WorkerMode[])(
    'parses %s',
    (mode) => {
      expect(parseWorkerMode({ WORKER_MODE: mode })).toBe(mode);
    },
  );

  it('trims and lowercases', () => {
    expect(parseWorkerMode({ WORKER_MODE: ' API ' })).toBe('api');
    expect(parseWorkerMode({ WORKER_MODE: 'Worker' })).toBe('worker');
    expect(parseWorkerMode({ WORKER_MODE: 'ALL' })).toBe('all');
  });

  it('falls back to all on an unknown value (fail-open, never silently off)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(parseWorkerMode({ WORKER_MODE: 'bogus' })).toBe('all');
      expect(parseWorkerMode({ WORKER_MODE: 'api-worker' })).toBe('all');
    } finally {
      warn.mockRestore();
    }
  });

  it('warns once for an invalid value', () => {
    // The warn-once flag lives in the helper module, so re-require it fresh.
    // (require, not dynamic import: this Jest setup has no
    // --experimental-vm-modules, so `await import()` throws.)
    jest.resetModules();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require('./worker-mode') as typeof import('./worker-mode');
      fresh.parseWorkerMode({ WORKER_MODE: 'nope' });
      fresh.parseWorkerMode({ WORKER_MODE: 'also-nope' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('Invalid WORKER_MODE');
    } finally {
      warn.mockRestore();
    }
  });

  it('reads process.env by default', () => {
    const prev = process.env.WORKER_MODE;
    process.env.WORKER_MODE = 'worker';
    try {
      expect(parseWorkerMode()).toBe('worker');
    } finally {
      if (prev === undefined) delete process.env.WORKER_MODE;
      else process.env.WORKER_MODE = prev;
    }
  });
});

describe('mode gating predicates', () => {
  it.each([
    // mode, processors, schedulers, http
    ['all', true, true, true],
    ['api', false, true, true],
    ['worker', true, false, false],
  ] as Array<[WorkerMode, boolean, boolean, boolean]>)(
    'mode %s → processors=%s schedulers=%s http=%s',
    (mode, processors, schedulers, http) => {
      expect(processorsEnabled(mode)).toBe(processors);
      expect(schedulersEnabled(mode)).toBe(schedulers);
      expect(httpEnabled(mode)).toBe(http);
    },
  );

  it('each side is registered exactly once across api + worker', () => {
    // The no-double-run invariant, as a truth table: processors run in
    // worker only, schedulers in api only, HTTP in api only.
    const api = {
      p: processorsEnabled('api'),
      s: schedulersEnabled('api'),
      h: httpEnabled('api'),
    };
    const worker = {
      p: processorsEnabled('worker'),
      s: schedulersEnabled('worker'),
      h: httpEnabled('worker'),
    };
    expect(api.p).toBe(false);
    expect(worker.p).toBe(true);
    expect(api.s).toBe(true);
    expect(worker.s).toBe(false);
    expect(api.h).toBe(true);
    expect(worker.h).toBe(false);
  });

  it('predicates read process.env when no mode is passed', () => {
    const prev = process.env.WORKER_MODE;
    process.env.WORKER_MODE = 'api';
    try {
      expect(processorsEnabled()).toBe(false);
      expect(schedulersEnabled()).toBe(true);
      expect(httpEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.WORKER_MODE;
      else process.env.WORKER_MODE = prev;
    }
  });
});
