import { describe, expect, it } from 'vitest';
import {
  collectAdCapture,
  newAdEventId,
  readCookieValue,
} from '../ad-capture';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('landing ad capture', () => {
  it('reads _fbp/_fbc cookies and ignores other cookies', () => {
    const cookies =
      'session=abc; _fbp=fb.1.1700000000.123456; other=x; _fbc=fb.1.1700000000.AbCdEf';
    expect(readCookieValue(cookies, '_fbp')).toBe('fb.1.1700000000.123456');
    expect(readCookieValue(cookies, '_fbc')).toBe('fb.1.1700000000.AbCdEf');
    expect(readCookieValue(cookies, '_nope')).toBeUndefined();
    expect(readCookieValue('', '_fbp')).toBeUndefined();
  });

  it('an empty cookie value reads as absent', () => {
    expect(readCookieValue('_fbp=; other=1', '_fbp')).toBeUndefined();
  });

  it('newAdEventId returns distinct UUIDs', () => {
    const first = newAdEventId();
    const second = newAdEventId();
    expect(first).toMatch(UUID_RE);
    expect(second).toMatch(UUID_RE);
    expect(first).not.toBe(second);
  });

  it('collects ttclid from the URL + cookies + two fresh dedup ids', () => {
    const capture = collectAdCapture(
      '?utm_source=meta&ttclid=abc123',
      '_fbp=fb.1.1.1; _fbc=fb.1.1.2',
    );
    expect(capture).toMatchObject({
      fbp: 'fb.1.1.1',
      fbc: 'fb.1.1.2',
      ttclid: 'abc123',
    });
    expect(capture.eventId).toMatch(UUID_RE);
    expect(capture.tiktokEventId).toMatch(UUID_RE);
    expect(capture.eventId).not.toBe(capture.tiktokEventId);
  });

  it('collects only the dedup ids when nothing is attributed', () => {
    const capture = collectAdCapture('', '');
    expect(capture.fbp).toBeUndefined();
    expect(capture.fbc).toBeUndefined();
    expect(capture.ttclid).toBeUndefined();
    expect(capture.eventId).toMatch(UUID_RE);
    expect(capture.tiktokEventId).toMatch(UUID_RE);
  });
});
