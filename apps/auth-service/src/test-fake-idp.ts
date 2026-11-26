// TEST-ONLY fake-IdP email driver (Q11 tests).
//
// The genericOAuth fake provider (enabled only when NODE_ENV=test and
// AUTH_FAKE_IDP_* are set — see src/config.ts) returns this email from
// getUserInfo, keyed per-test so one fake IdP can stand in for any user.
// Production providers return per-user ids natively; this module is never
// read in production.
let fakeEmail = 'fake-user@example.com';

export function setFakeIdpEmail(email: string): void {
  fakeEmail = email;
}

export function getFakeIdpEmail(): string {
  return fakeEmail;
}
