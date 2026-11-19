import { hashContact, type AdLeadContext, type AdSender } from './ad-sender';

/**
 * Stub sender (CMS batch 2, item 21) — the sender used in tests and in
 * live verification, selected with AD_DISPATCH_SENDER=stub. It records
 * every send (so tests can assert on the payload the dispatcher built)
 * and can be told to fail the first N sends
 * (AD_DISPATCH_STUB_FAIL_COUNT, or `failuresLeft` in tests) so the
 * retry/backoff ladder is exercisable without a real ad account.
 *
 * It never touches the network. One shared instance serves every
 * platform in stub mode; each record carries the platform it was
 * sent for.
 */
export interface StubSendRecord {
  platform: string;
  eventName: string;
  leadId: string;
  /** The dedup id the real sender would have used for this platform. */
  eventId: string;
  /** Hashed contact identifiers, as the real senders would send them. */
  hashedEmail?: string;
  hashedPhone?: string;
}

export class StubAdSender implements AdSender {
  readonly platform = 'stub';
  /** Sends recorded so far (in order). Tests assert on these. */
  readonly sent: StubSendRecord[] = [];
  /** Fails this many sends (then succeeds). Set via env or directly. */
  failuresLeft: number;

  constructor(failuresLeft = 0) {
    this.failuresLeft = failuresLeft;
  }

  async send(context: AdLeadContext): Promise<void> {
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error('stub send failure (injected)');
    }
    const { lead, dispatch } = context;
    // Mirror the real senders' dedup-id choice per platform so tests
    // prove the right id reaches the right platform.
    const eventId =
      context.platform === 'tiktok'
        ? lead.tiktokEventId || dispatch.id
        : lead.eventId || dispatch.id;
    const hashed = hashContact(lead.contact, lead.contactType);
    this.sent.push({
      platform: context.platform,
      eventName: dispatch.eventName,
      leadId: lead.id,
      eventId,
      hashedEmail: hashed.email,
      hashedPhone: hashed.phone,
    });
  }

  reset(): void {
    this.sent.length = 0;
    this.failuresLeft = 0;
  }
}
