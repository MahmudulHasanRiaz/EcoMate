import { ExportProgressRegistry } from './export-progress.registry';

describe('ExportProgressRegistry', () => {
  it('tracks a job from start to completion', async () => {
    const registry = new ExportProgressRegistry();
    const { jobId, promise } = registry.start('tenant-1');
    registry.update(jobId, {
      tablesTotal: 2,
      totalRows: 10,
      currentTable: 'Product',
    });
    expect(registry.runningFor('tenant-1')?.jobId).toBe(jobId);
    expect(registry.get(jobId)?.tablesTotal).toBe(2);

    const result = {
      path: '/exports/acme.json',
      filename: 'acme.json',
      sizeBytes: 99,
      exportedAt: new Date(),
      encrypted: false,
    };
    registry.complete(jobId, result);
    await expect(promise).resolves.toEqual(result);
    expect(registry.runningFor('tenant-1')).toBeUndefined();
    expect(registry.get(jobId)?.status).toBe('done');
    expect(registry.get(jobId)?.filename).toBe('acme.json');
    expect(registry.pathFor(jobId)).toBe('/exports/acme.json');
  });

  it('fails a job and rejects its waiters', async () => {
    const registry = new ExportProgressRegistry();
    const { jobId, promise } = registry.start('tenant-1');
    registry.fail(jobId, new Error('backend down'));
    await expect(promise).rejects.toThrow('backend down');
    expect(registry.get(jobId)?.status).toBe('failed');
    expect(registry.get(jobId)?.error).toBe('backend down');
    expect(registry.runningFor('tenant-1')).toBeUndefined();
  });

  it('returns undefined for unknown jobs', () => {
    const registry = new ExportProgressRegistry();
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.waitFor('nope')).toBeUndefined();
    expect(registry.pathFor('nope')).toBeNull();
    expect(registry.runningFor('tenant-1')).toBeUndefined();
  });

  it('ignores updates for unknown jobs', () => {
    const registry = new ExportProgressRegistry();
    expect(() =>
      registry.update('nope', { rowsWritten: 5 }),
    ).not.toThrow();
  });
});
