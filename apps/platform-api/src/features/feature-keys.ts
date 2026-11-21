import { BadRequestException } from '@nestjs/common';
import { FEATURE_KEYS } from '@ecomate/shared-types';

/**
 * Feature-key validation against the catalogue (deep-read/platform-api
 * §8 gap 11: plan create/version used to accept arbitrary strings).
 *
 * The '*' wildcard is allowed: it is the platform's all-features marker,
 * honoured by every feature check (TenantEntitlementsService.canUse,
 * the domains custom_domain check, the tenant admin hasFeature). It is
 * not a catalogue key, but it is not an arbitrary string either.
 */
const KNOWN_KEYS = new Set<string>([...FEATURE_KEYS, '*']);

export function findUnknownFeatureKeys(keys: string[]): string[] {
  return [...new Set(keys.filter((key) => !KNOWN_KEYS.has(key)))];
}

export function assertKnownFeatureKeys(
  keys: string[] | undefined | null,
): void {
  if (!keys || keys.length === 0) return;
  const unknown = findUnknownFeatureKeys(keys);
  if (unknown.length > 0) {
    throw new BadRequestException(
      `Unknown feature key(s): ${unknown.join(', ')}. Pick from the feature catalogue.`,
    );
  }
}
