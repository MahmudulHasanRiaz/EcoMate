import { InternalTrialReviewController } from './internal-trial-review.controller';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function makeController() {
  const requests = {
    getTrialReview: jest.fn(),
  };
  return {
    requests,
    controller: new InternalTrialReviewController(requests as any),
  };
}

describe('InternalTrialReviewController', () => {
  it('returns the trial review for the path tenant id', async () => {
    const { controller, requests } = makeController();
    const review = {
      tenantId: TENANT_ID,
      tenantName: 'My Store',
      subscriptionStatus: 'TRIAL',
      planName: 'Trial',
      planSlug: 'trial',
      isTrialPlan: true,
      trialEndsAt: new Date('2026-11-22T08:00:00.000Z'),
      graceEndsAt: null,
      trialAddOns: [],
      hasPendingRequest: false,
    };
    requests.getTrialReview.mockResolvedValue(review);

    const result = await controller.getTrialReview(TENANT_ID);

    expect(requests.getTrialReview).toHaveBeenCalledWith(TENANT_ID);
    expect(result).toEqual(review);
  });
});
