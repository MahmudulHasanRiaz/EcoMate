import { describe, expect, it } from 'vitest';
import { fetchApiHealth, resetApiHealthCache } from './api-status';

describe('fetchApiHealth', () => {
  it('returns true when the check succeeds', async () => {
    resetApiHealthCache();
    await expect(fetchApiHealth(async () => true)).resolves.toBe(true);
  });

  it('returns false when the check fails', async () => {
    resetApiHealthCache();
    await expect(fetchApiHealth(async () => false)).resolves.toBe(false);
  });

  it('returns false when the check throws (network failure)', async () => {
    resetApiHealthCache();
    await expect(fetchApiHealth(async () => {
      throw new Error('unreachable');
    })).resolves.toBe(false);
  });

  it('runs the check only once per session', async () => {
    resetApiHealthCache();
    let calls = 0;
    const check = async () => {
      calls += 1;
      return true;
    };
    const [first, second] = await Promise.all([
      fetchApiHealth(check),
      fetchApiHealth(check),
    ]);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(calls).toBe(1);
    // A later caller reuses the settled result without a new check.
    await fetchApiHealth(check);
    expect(calls).toBe(1);
  });

  it('runs a fresh check after a reset', async () => {
    resetApiHealthCache();
    let calls = 0;
    const check = async () => {
      calls += 1;
      return calls === 1;
    };
    await expect(fetchApiHealth(check)).resolves.toBe(true);
    resetApiHealthCache();
    await expect(fetchApiHealth(check)).resolves.toBe(false);
    expect(calls).toBe(2);
  });
});
