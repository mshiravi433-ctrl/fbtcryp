// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import en from '../src/i18n/locales/en.json';
import fa from '../src/i18n/locales/fa.json';
import ar from '../src/i18n/locales/ar.json';

vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));
vi.mock('../src/components/AnimatedIcon', () => ({ useStill: () => true }));
vi.mock('../src/store/useAppStore', () => ({ useAppStore: (select) => select({ notify: () => {} }) }));
vi.mock('../src/components/ModernSelect', () => ({ default: ({ value, onChange, options, title }) =>
  <select aria-label={title} value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
}));
const api = vi.hoisted(() => ({ getThorPools: vi.fn(), getThorQuote: vi.fn(), copyText: vi.fn() }));
vi.mock('../src/lib/thorswap', async (original) => ({ ...await original(), getThorPools: api.getThorPools, getThorQuote: api.getThorQuote }));
vi.mock('../src/lib/share', () => ({ copyText: api.copyText }));

import ThorPanel from '../src/components/ThorPanel';
import BridgeSigningReview from '../src/components/BridgeSigningReview';

const OWNER = '0x3456789012345678901234567890123456789012';
const VAULT = 'bc1qvaultaddressforuitest';
const i18n = createInstance();
await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en }, fa: { translation: fa }, ar: { translation: ar } }, interpolation: { escapeValue: false } });
const mount = (node) => render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
const advance = async (ms = 600) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const quote = () => ({ inbound_address: VAULT, memo: `=:ETH.ETH:${OWNER}:1000`, expected_amount_out: '100000000', expiry: Math.floor(Date.now() / 1000) + 300 });
const fill = () => {
  fireEvent.change(screen.getByLabelText(en.thor.amount), { target: { value: '0.01' } });
  fireEvent.change(screen.getByLabelText(en.thor.destination), { target: { value: OWNER } });
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  await i18n.changeLanguage('en');
  api.getThorPools.mockReset().mockResolvedValue({ items: [{ asset: 'BTC.BTC' }, { asset: 'ETH.ETH' }, { asset: 'GAIA.ATOM' }, { asset: 'LTC.LTC' }] });
  api.getThorQuote.mockReset().mockImplementation(async () => quote());
  api.copyText.mockReset().mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('native bridge interface', () => {
  it('explains OP_RETURN and wallet choice before the user has a quote', async () => {
    mount(<ThorPanel />); await advance();
    expect(screen.getByRole('button', { name: en.thor.guide.title }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/on-chain OP_RETURN output/)).toBeTruthy();
    expect(screen.getByText(/WalletConnect alone/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open THORSwap/ }).getAttribute('href')).toBe('https://app.thorswap.finance/');
    fireEvent.click(screen.getByRole('button', { name: en.thor.guide.title })); await advance();
    expect(screen.getByRole('button', { name: en.thor.guide.title }).getAttribute('aria-expanded')).toBe('false');
  });
  it('does not expose an API memo for a price-only quote without a destination', async () => {
    mount(<ThorPanel />); await advance();
    fireEvent.change(screen.getByLabelText(en.thor.amount), { target: { value: '0.01' } });
    await advance();
    expect(screen.getByText(en.thor.guide.state.destination)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.thor.guide.detailsTitle })).toBeNull();
    expect(screen.queryByText(VAULT)).toBeNull();
  });
  it('labels address roles, isolates LTR text, and hides copy controls after expiry', async () => {
    mount(<ThorPanel />); await advance(); fill(); await advance();
    fireEvent.click(screen.getByRole('button', { name: en.thor.guide.detailsTitle })); await advance();
    expect(screen.getByText(VAULT).getAttribute('dir')).toBe('ltr');
    expect(screen.getByText(OWNER).getAttribute('dir')).toBe('ltr');
    fireEvent.click(screen.getByRole('button', { name: en.thor.guide.copyMemo })); await advance();
    expect(api.copyText).toHaveBeenCalledWith(`=:ETH.ETH:${OWNER}:1000`);
    await advance(271_000);
    expect(screen.queryByRole('button', { name: en.thor.guide.copyMemo })).toBeNull();
    expect(screen.getByText(en.thor.guide.state.expired)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.thor.guide.refresh })); await advance();
    expect(screen.getByRole('button', { name: en.thor.guide.detailsTitle })).toBeTruthy();
  });
  it('discards a pending valid response when the amount is cleared', async () => {
    let resolve;
    api.getThorQuote.mockImplementation(() => new Promise((r) => { resolve = r; }));
    mount(<ThorPanel />); await advance(); fill(); await advance();
    fireEvent.change(screen.getByLabelText(en.thor.amount), { target: { value: '' } });
    await act(async () => resolve(quote()));
    expect(screen.queryByRole('button', { name: en.thor.guide.detailsTitle })).toBeNull();
    expect(screen.queryByText(VAULT)).toBeNull();
  });
  it('hides existing details immediately when the destination is edited', async () => {
    mount(<ThorPanel />); await advance(); fill(); await advance();
    fireEvent.click(screen.getByRole('button', { name: en.thor.guide.detailsTitle })); await advance();
    fireEvent.change(screen.getByLabelText(en.thor.destination), { target: { value: '0x123' } });
    expect(screen.queryByText(VAULT)).toBeNull();
    expect(screen.queryByRole('button', { name: en.thor.guide.copyMemo })).toBeNull();
  });
  it('explains router deposits for an EVM source, rather than an ordinary memo field', async () => {
    mount(<ThorPanel initialFrom="ETH.ETH" initialTo="BTC.BTC" />); await advance();
    expect(screen.getByText(/depositWithExpiry/)).toBeTruthy();
    expect(screen.queryByText(/on-chain OP_RETURN output/)).toBeNull();
  });
  it('shows a localized pool failure instead of an empty tab', async () => {
    api.getThorPools.mockRejectedValue(new Error('offline'));
    mount(<ThorPanel />); await advance();
    expect(screen.getByText(en.thor.err.POOLS_FAILED)).toBeTruthy();
  });
  it.each(['fa', 'ar'])('renders translated steps in %s', async (lang) => {
    await i18n.changeLanguage(lang);
    mount(<ThorPanel />); await advance();
    const dict = lang === 'fa' ? fa : ar;
    expect(screen.getByRole('button', { name: dict.thor.guide.title })).toBeTruthy();
    expect(screen.getByText(dict.thor.guide.noSend)).toBeTruthy();
    expect(screen.queryByText(en.thor.guide.manual)).toBeNull();
  });
});

it('reviews token and spender separately and lets the user cancel without opening a wallet', async () => {
  const onDecision = vi.fn();
  mount(<BridgeSigningReview review={{ token: '0x55d398326f99059ff775485246999027b3197955', spender: OWNER,
    contract: '0x1234567890123456789012345678901234567890', recipient: '0x4567890123456789012345678901234567890123',
    amount: '1000000000000000000', decimals: 18, symbol: 'USDT', chainId: 56, provider: 'LI.FI'
  }} onDecision={onDecision} />);
  expect(screen.getByText(en.bridge.safety.token)).toBeTruthy();
  expect(screen.getByText(en.bridge.safety.spender)).toBeTruthy();
  expect(screen.getByText(/Poisoning alert/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: en.bridge.cancel }));
  expect(onDecision).toHaveBeenCalledWith(false);
});

it('keeps all new safety translations and interpolation placeholders in sync', () => {
  const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]);
  for (const section of ['guide', 'safety']) {
    const key = section === 'guide' ? 'thor' : 'bridge';
    for (const [path, text] of flatten(en[key][section])) {
      for (const lang of [fa, ar]) {
        const translated = path.split('.').reduce((o, p) => o?.[p], lang[key][section]);
        expect(typeof translated, path).toBe('string');
        expect((translated.match(/\{\{\w+\}\}/g) || []).sort(), path).toEqual((text.match(/\{\{\w+\}\}/g) || []).sort());
      }
    }
  }
});
