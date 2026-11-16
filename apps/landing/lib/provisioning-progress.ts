export type ProvisioningJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED';

export interface ProvisioningInfo {
  status: ProvisioningJobStatus;
  step?: string;
  attempts?: number;
}

export type ProgressStepState = 'done' | 'active' | 'pending' | 'failed';

export interface ProgressStep {
  key: 'verified' | 'workspace' | 'preparing' | 'ready';
  label: string;
  detail: string;
  state: ProgressStepState;
}

export interface ProvisioningProgress {
  steps: ProgressStep[];
  ready: boolean;
  failed: boolean;
}

/**
 * Maps the platform job to the four steps shown after email verification.
 * `null` means the job has not been created yet (verify just returned); the
 * workspace step is active while we wait for the async trigger.
 */
export function deriveProvisioningProgress(
  info: ProvisioningInfo | null,
): ProvisioningProgress {
  const status = info?.status;
  const ready = status === 'SUCCEEDED';
  const failed = status === 'FAILED';
  const seeded =
    ready || (status === 'RUNNING' && info?.step === 'seeded');
  const working = !!info && !ready && !failed;

  return {
    ready,
    failed,
    steps: [
      {
        key: 'verified',
        label: 'Email verified',
        detail: 'Your address is confirmed.',
        state: 'done',
      },
      {
        key: 'workspace',
        label: 'Workspace created',
        detail: 'Your store address is reserved.',
        state: info ? 'done' : 'active',
      },
      {
        key: 'preparing',
        label: 'Preparing your store',
        detail: 'Settings, pages and starter access.',
        state: failed
          ? 'failed'
          : seeded
            ? 'done'
            : working
              ? 'active'
              : 'pending',
      },
      {
        key: 'ready',
        label: 'Ready to use',
        detail: 'Open your admin or storefront.',
        state: ready ? 'done' : failed ? 'failed' : 'pending',
      },
    ],
  };
}
