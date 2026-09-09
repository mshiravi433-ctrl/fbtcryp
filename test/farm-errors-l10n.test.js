// @vitest-environment jsdom
/**
 * ERRORS SPEAK THE DEVICE LANGUAGE.
 *
 * The adapters throw machine codes (LIDO_NETWORK_UNREADABLE, …) and the
 * panels used to paste those codes into the UI, so a Persian device read an
 * English error string. lib/defi/farmErrors.js is the single door through
 * which an adapter error becomes a sentence; this pins its contract:
 *
 *   · known network codes → localised sentence WITH the protocol name;
 *   · unknown codes → generic sentence that keeps the code for support;
 *   · human prose (decoded reverts) → passed through untouched;
 *   · feed errors ('Failed to fetch', 'YIELDS_EXPIRED', …) → localised.
 */
import { describe, expect, it } from 'vitest';
import en from '../src/i18n/locales/en.json';
import fa from '../src/i18n/locales/fa.json';
import { farmErrorLabel, farmErrorText, feedErrorLabel } from '../src/lib/defi/farmErrors';

const makeT = (dict) => (key, values = {}) => {
  const text = key.split('.').reduce((o, k) => o?.[k], dict) ?? values.defaultValue ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
};
const tEn = makeT(en);
const tFa = makeT(fa);

describe('farmErrors — device-language errors', () => {
  it.each([
    ['LIDO_NETWORK_UNREADABLE', 'Lido'],
    ['AAVE_NETWORK_UNREADABLE', 'Aave'],
    ['COMPOUND_NETWORK_UNREADABLE', 'Compound'],
    ['MORPHO_NETWORK_UNREADABLE', 'Morpho'],
    ['EXECUTION_NETWORK_UNREADABLE', null]
  ])('turns %s into the localised network sentence', (code, protocol) => {
    const err = { code };
    const enLabel = farmErrorLabel(err, tEn);
    const faLabel = farmErrorLabel(err, tFa);
    expect(enLabel).not.toContain('NETWORK_UNREADABLE');
    expect(faLabel).not.toMatch(/[A-Z]{4,}_/);
    if (protocol) {
      expect(enLabel).toContain(protocol);
      expect(faLabel).toContain(protocol);
    }
    expect(faLabel).toContain('شبکه');
  });

  it.each(['INSUFFICIENT_BALANCE', 'INSUFFICIENT_ALLOWANCE', 'USER_REJECTED', 'TIMEOUT'])(
    'localises %s instead of pasting the code', (code) => {
      expect(farmErrorLabel({ code }, tFa)).not.toContain(code);
      expect(farmErrorLabel({ code }, tEn)).not.toContain(code);
    });

  it('keeps the raw code only inside the generic form for unknown errors', () => {
    const faLabel = farmErrorLabel({ code: 'LIDO_SOMETHING_ELSE' }, tFa);
    expect(faLabel).toContain('LIDO_SOMETHING_ELSE');
    expect(faLabel.startsWith('خطا')).toBe(true);
    const enLabel = farmErrorLabel({ code: 'LIDO_SOMETHING_ELSE' }, tEn);
    expect(enLabel).toContain('LIDO_SOMETHING_ELSE');
  });

  it('passes decoded human prose through untouched', () => {
    expect(farmErrorLabel({ reason: 'execution reverted: 26' }, tFa)).toBe('execution reverted: 26');
  });

  it('prefers the protocol explainer key when one resolved', () => {
    const label = farmErrorText({ code: 'LIDO_NETWORK_UNREADABLE' }, tFa, { key: 'farm.lido.simBusy' });
    expect(label).toBe(fa.farm.lido.simBusy);
  });

  it('falls back to the code table when the explainer has no key', () => {
    const label = farmErrorText({ code: 'LIDO_NETWORK_UNREADABLE' }, tFa, { key: null });
    expect(label).toContain('شبکه');
    expect(label).toContain('Lido');
  });

  it.each(['Failed to fetch', 'NetworkError', 'load failed'])('localises feed offline errors (%s)', (msg) => {
    expect(feedErrorLabel(msg, tFa)).toBe(fa.farm.errors.feedOffline);
    expect(feedErrorLabel(msg, tEn)).toBe(en.farm.errors.feedOffline);
  });

  it('localises stale and malformed feed errors', () => {
    expect(feedErrorLabel('YIELDS_EXPIRED', tFa)).toBe(fa.farm.errors.feedExpired);
    expect(feedErrorLabel('BAD_SHAPE', tEn)).toBe(en.farm.errors.feedBadShape);
    expect(feedErrorLabel('HTTP 429', tEn)).toBe(en.farm.errors.feedHttp.replace('{{code}}', 'HTTP 429'));
  });

  it('returns null for an empty feed error', () => {
    expect(feedErrorLabel('', tEn)).toBeNull();
    expect(feedErrorLabel(null, tEn)).toBeNull();
  });
});
