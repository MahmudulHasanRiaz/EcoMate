import { Injectable } from '@nestjs/common';
import type { AdSender } from './senders/ad-sender';
import { MetaCapiSender } from './senders/meta-capi.sender';
import { StubAdSender } from './senders/stub.sender';
import { TikTokEventsSender } from './senders/tiktok-events.sender';

/**
 * Resolves a platform id to its sender (CMS batch 2, item 21). Adding
 * a platform = a registry row in ad-platforms.ts + a sender class +
 * one case here. An unknown platform has no sender: the service skips
 * its dispatches (logged) instead of failing them, so a half-wired
 * platform never burns retries.
 *
 * AD_DISPATCH_SENDER=stub routes EVERY platform through the shared
 * stub sender (tests + live verification; never the network). The
 * stub's failure count comes from AD_DISPATCH_STUB_FAIL_COUNT.
 */
@Injectable()
export class AdSenderRegistry {
  private readonly senders = new Map<string, AdSender>([
    ['meta', new MetaCapiSender()],
    ['tiktok', new TikTokEventsSender()],
  ]);
  private readonly stub = new StubAdSender(
    Number(process.env.AD_DISPATCH_STUB_FAIL_COUNT) || 0,
  );

  get(platform: string): AdSender | undefined {
    if (process.env.AD_DISPATCH_SENDER === 'stub') return this.stub;
    return this.senders.get(platform);
  }

  /** The shared stub instance (stub mode only; tests assert on it). */
  getStub(): StubAdSender {
    return this.stub;
  }
}
