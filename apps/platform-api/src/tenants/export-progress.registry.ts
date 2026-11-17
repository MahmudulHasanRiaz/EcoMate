import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

export type ExportJobStatus = 'running' | 'done' | 'failed';

export interface ExportResult {
  path: string;
  filename: string;
  sizeBytes: number;
  exportedAt: Date;
  encrypted: boolean;
}

export interface ExportProgress {
  jobId: string;
  tenantId: string;
  status: ExportJobStatus;
  tablesDone: number;
  tablesTotal: number;
  rowsWritten: number;
  totalRows: number | null;
  currentTable: string | null;
  startedAt: string;
  finishedAt: string | null;
  filename: string | null;
  sizeBytes: number | null;
  encrypted: boolean;
  error: string | null;
}

interface JobEntry {
  progress: ExportProgress;
  /** Resolves with the export result (or rejects) when the job finishes. */
  promise: Promise<ExportResult>;
  resolve: (result: ExportResult) => void;
  reject: (error: Error) => void;
  /** Server-side only: the finished file path, for the download endpoint. */
  path: string | null;
}

/** Finished jobs are kept for status polling, then pruned. */
const COMPLETED_JOB_TTL_MS = 60 * 60_000;

/**
 * In-memory registry for tenant exports (Phase 8 item 26).
 *
 * Exports are long-running (a large tenant streams for minutes), so the
 * platform tracks each one as a job: the operator polls progress, and a
 * purge that finds an export already running for the tenant awaits its
 * completion instead of starting a second one. Single-instance only, like
 * the billing jobs — the platform API does not run replicated.
 */
@Injectable()
export class ExportProgressRegistry {
  private readonly jobs = new Map<string, JobEntry>();

  start(tenantId: string): { jobId: string; promise: Promise<ExportResult> } {
    this.prune();
    const jobId = randomUUID();
    let resolve!: (result: ExportResult) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<ExportResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Awaited by whoever started the job or joined it; a rejection with no
    // waiter must not become an unhandled rejection.
    promise.catch(() => undefined);
    this.jobs.set(jobId, {
      progress: {
        jobId,
        tenantId,
        status: 'running',
        tablesDone: 0,
        tablesTotal: 0,
        rowsWritten: 0,
        totalRows: null,
        currentTable: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        filename: null,
        sizeBytes: null,
        encrypted: false,
        error: null,
      },
      promise,
      resolve,
      reject,
      path: null,
    });
    return { jobId, promise };
  }

  /** The running job for a tenant, if one exists (for join-instead-of-start). */
  runningFor(tenantId: string): ExportProgress | undefined {
    for (const entry of this.jobs.values()) {
      if (
        entry.progress.tenantId === tenantId &&
        entry.progress.status === 'running'
      ) {
        return entry.progress;
      }
    }
    return undefined;
  }

  get(jobId: string): ExportProgress | undefined {
    return this.jobs.get(jobId)?.progress;
  }

  /** The completion promise for a job (for purge awaiting an in-flight export). */
  waitFor(jobId: string): Promise<ExportResult> | undefined {
    return this.jobs.get(jobId)?.promise;
  }

  /** Server-side file path of a finished export (for the download endpoint). */
  pathFor(jobId: string): string | null {
    return this.jobs.get(jobId)?.path ?? null;
  }

  update(jobId: string, patch: Partial<ExportProgress>): void {
    const entry = this.jobs.get(jobId);
    if (!entry) return;
    Object.assign(entry.progress, patch);
  }

  complete(jobId: string, result: ExportResult): void {
    const entry = this.jobs.get(jobId);
    if (!entry) return;
    entry.path = result.path;
    Object.assign(entry.progress, {
      status: 'done',
      finishedAt: new Date().toISOString(),
      currentTable: null,
      filename: result.filename,
      sizeBytes: result.sizeBytes,
      encrypted: result.encrypted,
    } satisfies Partial<ExportProgress>);
    entry.resolve(result);
  }

  fail(jobId: string, error: Error): void {
    const entry = this.jobs.get(jobId);
    if (!entry) return;
    Object.assign(entry.progress, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      currentTable: null,
      error: error.message,
    } satisfies Partial<ExportProgress>);
    entry.reject(error);
  }

  private prune(): void {
    const cutoff = Date.now() - COMPLETED_JOB_TTL_MS;
    for (const [jobId, entry] of this.jobs) {
      if (
        entry.progress.status !== 'running' &&
        entry.progress.finishedAt &&
        new Date(entry.progress.finishedAt).getTime() < cutoff
      ) {
        this.jobs.delete(jobId);
      }
    }
  }
}
