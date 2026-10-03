import { describe, expect, it, vi } from 'vitest';
import { SEO_LANDING_URL, isOnboardedFromStorage, seoEntryHandoff, seoEntryRedirect } from '../src/lib/webEntry.js';

/**
 * WHO GETS THE APP, WHO GETS THE SEO PAGE.
 * ===========================================================================
 *   «صفحهٔ خوش‌آمد فقط در اپ اندروید و در حالت اپ وب بماند؛ کاربری که با مرورگر
 *    می‌آید نباید صفحهٔ خوش‌آمد را ببیند — باید برود به
 *    https://fbtswap.ir/decentralized-crypto-exchange.»
 *
 * Both ways of getting this wrong are invisible in a build:
 *
 *   · redirect too eagerly → a returning user, or someone who tapped a swap
 *     link, is thrown out of the app they were using, and (worst of all) the
 *     APK opens the website instead of the app;
 *   · redirect too rarely → crawlers keep landing on the onboarding form and
 *     nothing about the SEO work is visible.
 *
 * So every branch is asserted here rather than reasoned about in a comment.
 */
describe('web entry: app vs SEO landing', () => {
  const caseOf = (href, extra = {}) => seoEntryRedirect({ href, ...extra });

  it('sends a bare web visit to the landing page', () => {
    expect(caseOf('https://fbtswap.ir/')).toBe(SEO_LANDING_URL);
    expect(caseOf('https://fbtswap.ir/#/')).toBe(SEO_LANDING_URL);
    expect(caseOf('https://fbtswap.ir/#')).toBe(SEO_LANDING_URL);
    expect(caseOf('https://fbtswap.ir/?utm_source=google')).toBe(SEO_LANDING_URL);
  });

  it('never redirects the packaged app', () => {
    expect(caseOf('https://localhost/', { native: true })).toBeNull();
    expect(caseOf('https://localhost/#/swap', { native: true })).toBeNull();
  });

  it('never redirects a returning user', () => {
    expect(caseOf('https://fbtswap.ir/', { onboarded: true })).toBeNull();
  });

  it('never redirects a deep link — those are destinations, not the front door', () => {
    for (const hash of ['#/swap', '#/orders', '#/intent', '#/pay/abc', '#/coin/bitcoin', '#/solana?to=x']) {
      expect(caseOf(`https://fbtswap.ir/${hash}`), hash).toBeNull();
    }
  });

  it('honours the explicit app entry link in both spellings', () => {
    expect(caseOf('https://fbtswap.ir/?app=1')).toBeNull();
    expect(caseOf('https://fbtswap.ir/?welcome=1')).toBeNull();
    expect(caseOf('https://fbtswap.ir/?app=1#/')).toBeNull();
    // …and inside the hash too, for a link written as `/#/swap?app=1`.
    expect(caseOf('https://fbtswap.ir/#/?app=1')).toBeNull();
  });

  it('does not treat a parameter that merely contains "app" as the escape hatch', () => {
    expect(caseOf('https://fbtswap.ir/?apple=1')).toBe(SEO_LANDING_URL);
  });

  it('a broken href stays put rather than throwing the user somewhere', () => {
    expect(caseOf('')).toBe(SEO_LANDING_URL); // empty falls back to the production root
    expect(seoEntryRedirect({ href: 'not a url at all ' })).toBe(SEO_LANDING_URL);
  });
});

describe('web entry: the persisted onboarding flag', () => {
  const storage = (value) => ({ getItem: () => value });

  it('reads the flag out of the zustand persist blob', () => {
    expect(isOnboardedFromStorage(storage(JSON.stringify({ state: { onboarded: true }, version: 3 })))).toBe(true);
    expect(isOnboardedFromStorage(storage(JSON.stringify({ state: { onboarded: false } })))).toBe(false);
  });

  it('treats anything unreadable as "not onboarded"', () => {
    expect(isOnboardedFromStorage(storage('{oops'))).toBe(false);
    expect(isOnboardedFromStorage(storage(null))).toBe(false);
    expect(isOnboardedFromStorage({ getItem: () => { throw new Error('private mode'); } })).toBe(false);
    expect(isOnboardedFromStorage(undefined)).toBe(false);
  });
});

describe('web entry: the handoff itself', () => {
  const loc = (href) => ({ href, replace: vi.fn() });

  it('replaces rather than pushes, so Back cannot bounce off the redirect', () => {
    const l = loc('https://fbtswap.ir/');
    const gone = seoEntryHandoff({ native: false, storage: { getItem: () => null }, location: l });
    expect(gone).toBe(true);
    expect(l.replace).toHaveBeenCalledWith(SEO_LANDING_URL);
  });

  it('stays put — and touches nothing — on the native shell', () => {
    const l = loc('https://localhost/');
    expect(seoEntryHandoff({ native: true, storage: { getItem: () => null }, location: l })).toBe(false);
    expect(l.replace).not.toHaveBeenCalled();
  });

  it('survives a browser that refuses the navigation', () => {
    const l = loc('https://fbtswap.ir/');
    l.replace = () => { throw new Error('blocked'); };
    expect(seoEntryHandoff({ native: false, storage: { getItem: () => null }, location: l })).toBe(false);
  });
});
