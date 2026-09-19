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
vi.mock('../src/store/useAppStore', () => ({
  useAppStore: (select) => select({ notify: () => {} }),
  /* ThorPanel calls getState() on the broadcast path — the rewards write. */
  getState: () => ({ awardPoints: vi.fn() })
}));
vi.mock('../src/components/ModernSelect', () => ({ default: ({ value, onChange, options, title }) =>
  <select aria-label={title} value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
}));
/*
 * The wallet is a controllable object rather than a vi.fn on the module, so
 * tests can flip isConnected/address/chainId between mounts — the sign-here
 * card renders differently for a connected EVM wallet, an unconnected one
 * and a Bitcoin source.
 */
const walletApi = vi.hoisted(() => ({
  isConnected: false, address: null, chainId: null,
  getSigner: () => null, switchChain: vi.fn(async () => true)
}));
vi.mock('../src/context/WalletContext', () => ({ useWallet: () => walletApi }));
/* The money path is mocked at its boundary; its own suite tests it for real. */
const thorExec = vi.hoisted(() => ({ executeThorEvmDeposit: vi.fn() }));
vi.mock('../src/lib/thorEvmDeposit', async (original) => ({
  ...await original(),
  executeThorEvmDeposit: thorExec.executeThorEvmDeposit
}));
const api = vi.hoisted(() => ({ getThorPools: vi.fn(), getThorQuote: vi.fn(), getThorTxStatus: vi.fn(), copyText: vi.fn() }));
vi.mock('../src/lib/thorswap', async (original) => ({ ...await original(), getThorPools: api.getThorPools, getThorQuote: api.getThorQuote, getThorTxStatus: api.getThorTxStatus }));
vi.mock('../src/lib/share', () => ({ copyText: api.copyText }));

import ThorPanel from '../src/components/ThorPanel';
import BridgeSigningReview from '../src/components/BridgeSigningReview';

const OWNER = '0x3456789012345678901234567890123456789012';
const VAULT = 'bc1qvaultaddressforuitest';
/* A real bech32 BTC address: the EVM-source tests receive BTC, so the
   destination must be a Bitcoin address or checkDestination says wrong-chain. */
const BTC_DEST = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
const ROUTER = '0x1111111111111111111111111111111111111111';
const EVM_VAULT = '0x2222222222222222222222222222222222222222';
const i18n = createInstance();
await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en }, fa: { translation: fa }, ar: { translation: ar } }, interpolation: { escapeValue: false } });
const mount = (node) => render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
const advance = async (ms = 600) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const quote = () => ({ inbound_address: VAULT, memo: `=:ETH.ETH:${OWNER}:1000`, expected_amount_out: '100000000', expiry: Math.floor(Date.now() / 1000) + 300 });
const fill = () => {
  fireEvent.change(screen.getByLabelText(en.thor.amount), { target: { value: '0.01' } });
  fireEvent.change(screen.getByLabelText(en.thor.destination), { target: { value: OWNER } });
};
/* An EVM-source quote: router + EVM vault + a memo paying a Bitcoin address. */
const evmQuote = () => ({
  inbound_address: EVM_VAULT,
  router: ROUTER,
  memo: `=:BTC.BTC:${BTC_DEST}:1000`,
  expected_amount_out: '100000000',
  expiry: Math.floor(Date.now() / 1000) + 300
});

beforeEach(async () => {
  vi.useFakeTimers();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  await i18n.changeLanguage('en');
  walletApi.isConnected = false;
  walletApi.address = null;
  walletApi.chainId = null;
  api.getThorPools.mockReset().mockResolvedValue({ items: [{ asset: 'BTC.BTC' }, { asset: 'ETH.ETH' }, { asset: 'GAIA.ATOM' }, { asset: 'LTC.LTC' }] });
  api.getThorQuote.mockReset().mockImplementation(async () => quote());
  api.getThorTxStatus.mockReset().mockResolvedValue({ stages: {} });
  api.copyText.mockReset().mockResolvedValue(true);
  thorExec.executeThorEvmDeposit.mockReset();
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

  /*
   * ─── THE IN-SITE SIGNING PATH («نمیشه در خود سایت ما انجام شود») ──────────
   * An EVM source with a ready quote must offer to sign the deposit ON THIS
   * PAGE with the connected wallet — the card, the execution handoff, and
   * the tracker that follows the transfer through THORChain itself.
   */
  it('signs an EVM-source deposit on the page and then tracks it through THORChain', async () => {
    walletApi.isConnected = true;
    walletApi.address = OWNER;
    walletApi.chainId = 1;
    api.getThorQuote.mockImplementation(async () => evmQuote());
    const txHash = '0x' + 'ab'.repeat(32);
    thorExec.executeThorEvmDeposit.mockResolvedValue({ hash: txHash, chainId: 1 });
    mount(<ThorPanel initialFrom="ETH.ETH" initialTo="BTC.BTC" />); await advance();
    /* The guide's sign-here chip: EVM source, so it appears. */
    expect(screen.getByText(en.thor.guide.signHere)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(en.thor.amount), { target: { value: '0.01' } });
    fireEvent.change(screen.getByLabelText(en.thor.destination), { target: { value: BTC_DEST } });
    await advance();
    expect(screen.getByText(en.thor.sign.title)).toBeTruthy();
    const cta = screen.getByRole('button', { name: en.thor.sign.cta });
    fireEvent.click(cta); await advance();
    /* Everything the money path needs travelled in ONE handoff. */
    expect(thorExec.executeThorEvmDeposit).toHaveBeenCalledTimes(1);
    const arg = thorExec.executeThorEvmDeposit.mock.calls[0][0];
    expect(arg.from).toBe('ETH.ETH');
    expect(arg.to).toBe('BTC.BTC');
    expect(arg.destination).toBe(BTC_DEST);
    expect(arg.quote.router).toBe(ROUTER);
    expect(arg.wallet.address).toBe(OWNER);
    /* The tracker replaces the sign card once the deposit is broadcast. */
    expect(screen.getByText(en.thor.sign.trackTitle)).toBeTruthy();
    expect(screen.getByText(en.thor.sign.track.seen)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.thor.sign.cta })).toBeNull();
    const explorer = screen.getByRole('link', { name: /↗/ });
    expect(explorer.getAttribute('href')).toContain(txHash);
  });

  it('translates the failure when the user rejects the signature', async () => {
    walletApi.isConnected = true;
    walletApi.address = OWNER;
    walletApi.chainId = 1;
    api.getThorQuote.mockImplementation(async () => evmQuote());
    thorExec.executeThorEvmDeposit.mockRejectedValue(new Error('USER_REJECTED'));
    mount(<ThorPanel initialFrom="ETH.ETH" initialTo="BTC.BTC" />); await advance();
    fireEvent.change(screen.getByLabelText(en.thor.amount), { target: { value: '0.01' } });
    fireEvent.change(screen.getByLabelText(en.thor.destination), { target: { value: BTC_DEST } });
    await advance();
    fireEvent.click(screen.getByRole('button', { name: en.thor.sign.cta })); await advance();
    expect(screen.getByText(en.thor.sign.err.USER_REJECTED)).toBeTruthy();
  });

  it('asks for a wallet before it can sign, not after', async () => {
    api.getThorQuote.mockImplementation(async () => evmQuote());
    mount(<ThorPanel initialFrom="ETH.ETH" initialTo="BTC.BTC" />); await advance();
    fireEvent.change(screen.getByLabelText(en.thor.amount), { target: { value: '0.01' } });
    fireEvent.change(screen.getByLabelText(en.thor.destination), { target: { value: BTC_DEST } });
    await advance();
    expect(screen.getByText(en.thor.sign.connectFirst)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.thor.sign.cta })).toBeNull();
  });

  it('never offers in-site signing for a Bitcoin source — the manual guide is the only path', async () => {
    walletApi.isConnected = true;
    walletApi.address = OWNER;
    walletApi.chainId = 1;
    /* Default pair is BTC.BTC → ETH.ETH; a router on the quote must not be
       enough — the SOURCE chain is what decides signability. */
    api.getThorQuote.mockImplementation(async () => ({ ...quote(), router: ROUTER }));
    mount(<ThorPanel />); await advance(); fill(); await advance();
    expect(screen.queryByText(en.thor.sign.title)).toBeNull();
    expect(screen.queryByText(en.thor.guide.signHere)).toBeNull();
    expect(screen.queryByRole('button', { name: en.thor.sign.cta })).toBeNull();
    /* The manual path is intact. */
    expect(screen.getByRole('button', { name: en.thor.guide.detailsTitle })).toBeTruthy();
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
