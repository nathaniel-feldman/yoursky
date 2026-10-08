// Client helpers: referral capture, the anonymous stash, in-app browser detection and the checkout link.
import { describe, it, expect, beforeEach } from 'vitest';
import { captureReferral, getReferral, REF_KEY, REF_TTL_MS } from '../app/src/referral.js';
import { saveStash, loadStash, clearStash, snapshotOf, STASH_KEY } from '../app/src/stash.js';
import { isInAppBrowser } from '../app/src/inapp.js';
import { safeLocalStorage } from '../app/src/storage.js';
import { buildCheckoutUrl } from '../app/src/checkout.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

describe('referral capture', () => {
  let store;
  beforeEach(() => (store = memoryStorage()));
  const T0 = 1_800_000_000_000;

  it('stores ?aff=, ?ref= or ?code=, with ?code= also kept as a discount code', () => {
    expect(captureReferral('https://findyoursky.com/?aff=1234', store, T0)).toEqual({ ref: '1234', discount: null, at: T0 });
    store = memoryStorage();
    expect(captureReferral('https://findyoursky.com/?ref=maya_reads', store, T0).ref).toBe('maya_reads');
    store = memoryStorage();
    expect(captureReferral('https://findyoursky.com/f/X?code=CREATOR10', store, T0)).toEqual({ ref: 'CREATOR10', discount: 'CREATOR10', at: T0 });
  });

  it('prefers the affiliate id but keeps the discount code when both are present', () => {
    expect(captureReferral('https://x.test/?code=SAVE&aff=77', store, T0)).toEqual({ ref: '77', discount: 'SAVE', at: T0 });
  });

  it('first touch wins for 30 days, then a new code can replace it', () => {
    captureReferral('https://x.test/?ref=first', store, T0);
    expect(captureReferral('https://x.test/?ref=second', store, T0 + 1000).ref).toBe('first');
    expect(getReferral(store, T0 + REF_TTL_MS - 1).ref).toBe('first');
    expect(getReferral(store, T0 + REF_TTL_MS + 1)).toBeNull();
    expect(store.getItem(REF_KEY)).toBeNull();
    expect(captureReferral('https://x.test/?ref=second', store, T0 + REF_TTL_MS + 2).ref).toBe('second');
  });

  it('ignores unsafe or oversized values and pages without a code', () => {
    expect(captureReferral('https://x.test/?ref=<script>', store, T0)).toBeNull();
    expect(captureReferral(`https://x.test/?ref=${'a'.repeat(65)}`, store, T0)).toBeNull();
    expect(captureReferral('https://x.test/', store, T0)).toBeNull();
    expect(captureReferral('not a url', store, T0)).toBeNull();
    expect(store.m.size).toBe(0);
  });

  it('survives corrupted storage and storage that throws', () => {
    store.setItem(REF_KEY, '{oops');
    expect(getReferral(store, T0)).toBeNull();
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {} };
    expect(captureReferral('https://x.test/?ref=a', broken, T0).ref).toBe('a');
    expect(getReferral(broken, T0)).toBeNull();
  });
});

describe('anonymous stash', () => {
  const S = { profile: { name: 'Ava', gpa: 3.8, sat: 1400, major: 'cs', region: 'ne' }, answers: { size: 40 }, kept: [1, 2], passed: [3], income: 2 };

  it('round-trips the sky and expires after 30 days', () => {
    const store = memoryStorage();
    saveStash(store, S, 1000);
    expect(loadStash(store, 2000)).toMatchObject({ kept: [1, 2], income: 2, profile: { gpa: 3.8 } });
    expect(loadStash(store, 1000 + 31 * 864e5)).toBeNull();
    clearStash(store);
    expect(store.getItem(STASH_KEY)).toBeNull();
  });

  it('rejects malformed data', () => {
    const store = memoryStorage();
    store.setItem(STASH_KEY, JSON.stringify({ v: 2, kept: [] }));
    expect(loadStash(store)).toBeNull();
    store.setItem(STASH_KEY, 'nope');
    expect(loadStash(store)).toBeNull();
  });

  it('snapshots for saving never include grades, scores, budget, income or state', () => {
    const snap = snapshotOf({ ...S.profile, budget: 30000, state: 'NY', testMode: 'sat', act: 30 });
    expect(snap).toEqual({ name: 'Ava', major: 'cs', region: 'ne' });
  });
});

describe('in-app browsers', () => {
  it('detects TikTok, Instagram, Facebook and Snapchat, not Safari or Chrome', () => {
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_36.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0',
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0]',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/13.10',
    ]) expect(isInAppBrowser(ua), ua).toBe(true);
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
    ]) expect(isInAppBrowser(ua), ua).toBe(false);
  });
});

describe('checkout link', () => {
  const base = 'https://yoursky.lemonsqueezy.com/checkout/buy/abc-123';
  it('carries the user id, email and creator code the way Lemon Squeezy expects', () => {
    const u = new URL(buildCheckoutUrl(base, { userId: 'u-1', email: 'a@b.co', discount: 'CREATOR10', ref: '77' }));
    expect(u.origin + u.pathname).toBe(base);
    expect(u.searchParams.get('checkout[custom][user_id]')).toBe('u-1');
    expect(u.searchParams.get('checkout[email]')).toBe('a@b.co');
    expect(u.searchParams.get('checkout[discount_code]')).toBe('CREATOR10');
    expect(u.searchParams.get('checkout[custom][discount_code]')).toBe('CREATOR10');
    expect(u.searchParams.get('checkout[custom][referral]')).toBe('77');
    expect(u.searchParams.get('embed')).toBe('1');
  });
  it('leaves out what it does not have', () => {
    const u = new URL(buildCheckoutUrl(base, { userId: 'u-1' }));
    expect([...u.searchParams.keys()].sort()).toEqual(['checkout[custom][user_id]', 'embed']);
  });
});

describe('safe storage', () => {
  it('falls back to memory when the browser blocks localStorage', () => {
    const blocked = {};
    Object.defineProperty(blocked, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
    const s = safeLocalStorage(blocked);
    s.setItem('k', 'v');
    expect(s.getItem('k')).toBe('v');
    s.removeItem('k');
    expect(s.getItem('k')).toBeNull();
  });
});
