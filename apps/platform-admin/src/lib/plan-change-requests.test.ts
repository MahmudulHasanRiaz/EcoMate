import { describe, expect, it } from 'vitest';
import type { PlanChangeRequest } from '../types';
import {
  canDecidePlanChangeRequest,
  EFFECTIVE_AT_LABELS,
  isValidRejectionReason,
  planChangeSummary,
  PLAN_CHANGE_REQUEST_STATUSES,
} from './plan-change-requests';

function makeRequest(
  overrides: Partial<PlanChangeRequest> = {},
): PlanChangeRequest {
  return {
    id: 'req-1',
    tenantId: 'tenant-1',
    targetPlanId: 'plan-2',
    targetPlanVersionId: 'version-2',
    targetPlanName: 'Growth',
    status: 'PENDING',
    note: null,
    rejectionReason: null,
    requestedBy: null,
    createdAt: '2026-11-19T08:00:00.000Z',
    decidedAt: null,
    tenant: {
      id: 'tenant-1',
      name: 'My Store',
      slug: 'mystore',
      currentPlanName: 'Starter',
    },
    ...overrides,
  };
}

describe('plan-change-requests lib', () => {
  it('lists the three request statuses', () => {
    expect(PLAN_CHANGE_REQUEST_STATUSES).toEqual([
      'PENDING',
      'APPLIED',
      'REJECTED',
    ]);
  });

  it('labels both effectiveAt options', () => {
    expect(EFFECTIVE_AT_LABELS.immediate).toMatch(/Immediately/);
    expect(EFFECTIVE_AT_LABELS.next_period).toMatch(/Next period/);
  });

  it('lets only SUPERADMIN and BILLING decide requests', () => {
    expect(canDecidePlanChangeRequest('SUPERADMIN')).toBe(true);
    expect(canDecidePlanChangeRequest('BILLING')).toBe(true);
    expect(canDecidePlanChangeRequest('SUPPORT')).toBe(false);
    expect(canDecidePlanChangeRequest('READONLY')).toBe(false);
    expect(canDecidePlanChangeRequest(undefined)).toBe(false);
    expect(canDecidePlanChangeRequest(null)).toBe(false);
  });

  it('summarises the change as current → target', () => {
    expect(planChangeSummary(makeRequest())).toBe('Starter → Growth');
  });

  it('summarises a tenant with no plan as "No plan → target"', () => {
    const request = makeRequest();
    request.tenant.currentPlanName = null;
    expect(planChangeSummary(request)).toBe('No plan → Growth');
  });

  it('requires a rejection reason of at least 3 characters', () => {
    expect(isValidRejectionReason('Too soon')).toBe(true);
    expect(isValidRejectionReason('  No  ')).toBe(false);
    expect(isValidRejectionReason('')).toBe(false);
    expect(isValidRejectionReason('   ')).toBe(false);
  });
});
