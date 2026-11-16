import { describe, expect, it } from 'vitest';
import { deriveProvisioningProgress } from '../provisioning-progress';

describe('deriveProvisioningProgress', () => {
  it('shows the workspace step while the job does not exist yet', () => {
    const progress = deriveProvisioningProgress(null);
    expect(progress.ready).toBe(false);
    expect(progress.failed).toBe(false);
    expect(progress.steps[1]).toMatchObject({
      key: 'workspace',
      state: 'active',
    });
    expect(progress.steps[2].state).toBe('pending');
  });

  it('marks the workspace done and preparation active while seeding', () => {
    const progress = deriveProvisioningProgress({
      status: 'RUNNING',
      step: 'seeding',
      attempts: 1,
    });
    expect(progress.steps[1].state).toBe('done');
    expect(progress.steps[2].state).toBe('active');
    expect(progress.steps[3].state).toBe('pending');
  });

  it('marks preparation done once the seed is written', () => {
    const progress = deriveProvisioningProgress({
      status: 'RUNNING',
      step: 'seeded',
    });
    expect(progress.steps[2].state).toBe('done');
    expect(progress.steps[3].state).toBe('pending');
  });

  it('reports ready only for SUCCEEDED', () => {
    const progress = deriveProvisioningProgress({ status: 'SUCCEEDED' });
    expect(progress.ready).toBe(true);
    expect(progress.steps.every((step) => step.state === 'done')).toBe(true);
  });

  it('marks the failed steps for a retryable job', () => {
    const progress = deriveProvisioningProgress({
      status: 'FAILED',
      step: 'failed',
    });
    expect(progress.failed).toBe(true);
    expect(progress.steps[2].state).toBe('failed');
    expect(progress.steps[3].state).toBe('failed');
  });
});
