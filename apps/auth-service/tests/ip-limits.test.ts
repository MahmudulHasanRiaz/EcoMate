// Unit tests for the in-memory per-IP guard (no server needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { IpLimiter } from '../src/ip-limits.js';

test('IpLimiter allows exactly maxFailures events, then blocks', () => {
  const limiter = new IpLimiter({ maxFailures: 3, windowSeconds: 60, blockMinutes: 15 });
  assert.equal(limiter.isBlocked('1.2.3.4'), false);
  limiter.record('1.2.3.4');
  limiter.record('1.2.3.4');
  assert.equal(limiter.isBlocked('1.2.3.4'), false, 'below threshold: not blocked');
  limiter.record('1.2.3.4');
  assert.equal(limiter.isBlocked('1.2.3.4'), true, 'at threshold: blocked for subsequent requests');
  assert.equal(limiter.isBlocked('5.6.7.8'), false, 'other IPs unaffected');
});

test('IpLimiter reset clears the block', () => {
  const limiter = new IpLimiter({ maxFailures: 2, windowSeconds: 60, blockMinutes: 15 });
  limiter.record('1.2.3.4');
  limiter.record('1.2.3.4');
  assert.equal(limiter.isBlocked('1.2.3.4'), true);
  limiter.reset('1.2.3.4');
  assert.equal(limiter.isBlocked('1.2.3.4'), false);
});

test('IpLimiter does not count events while already blocked', () => {
  const limiter = new IpLimiter({ maxFailures: 2, windowSeconds: 60, blockMinutes: 15 });
  limiter.record('1.2.3.4');
  limiter.record('1.2.3.4');
  limiter.record('1.2.3.4'); // ignored while blocked
  limiter.reset('1.2.3.4');
  assert.equal(limiter.isBlocked('1.2.3.4'), false);
  limiter.record('1.2.3.4');
  assert.equal(limiter.isBlocked('1.2.3.4'), false, 'one fresh event after reset is not a block');
});
