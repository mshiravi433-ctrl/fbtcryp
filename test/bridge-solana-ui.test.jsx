// @vitest-environment jsdom
/*
 * THE REPORTED BUGS, AS TESTS
 * ---------------------------------------------------------------------------
 * Two reports from the same screen (Bridge → تب سولانا):
 *
 *   1. «هشدار کارمزد ثابت SOL حدود 1500000000.0٪» — the typed amount (whole
 *      SOL) was divided by 10**decimals a SECOND time inside the burden
 *      calculation, so the implied SOL price came back a billion times too
 *      high and the flat-fee warning printed a billion-scale percentage.
 *
 *   2. «انگار ارتباط برقرار نیست و می‌زند تراکنش ارسال نشد» — every failure
 *      of execute() collapsed into one generic sentence, including the two
 *      most common real reasons (the user rejected the prompt, and the wallet
 *      is short of the SOL the DLN flat fee needs ON TOP of the transfer).
 *
 * The quotes and the wallet are mocked at the same module boundary the EVM
 * bridge test uses; everything between — the burden math, the pre-flight
 * funding check, the error mapping — is the real component.
 */
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fa from '../src/i18n/locales/fa.json';

const state = vi.hoisted(() => ({
  address: '9Z4wtiosH7JMXhKg8JpUPDCtB5ZyM8vzby14HwDidgVz',
  evmAddress: '0x3456789012345678901234567890123456789012',
  getDlnQuote: vi.fn(),
  getDlnTx: vi.fn(),
  signAndSend: vi.fn(),
  getBalance: vi.fn()
}));

/* Same t() double the wallet-sheet test uses: the fa bundle, {{var}}
   interpolation, and the i18next string-defaultValue overload. */
const t = (key, values = {}) => {
  const found = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), fa);
  let text = typeof found === 'string' ? found : undefined;
  if (text == null && typeof values === 'string') text = values;
  if (text == null) text = key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) =>
    (values && typeof values === 'object' ? (values[k] ?? '') : ''));
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'fa' } }) }));

vi.mock('framer-motion', () => {
  const components = new Map();
  return {
    motion: new Proxy({}, {
      get: (_, tag) => {
        if (!components.has(tag)) {
          components.set(tag, ({ children, ...props }) => {
            const Tag = String(tag);
            const clean = Object.fromEntries(
              Object.entries(props).filter(([k]) => ![
                'initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'
              ].includes(k))
            );
            return <Tag {...clean}>{children}</Tag>;
          });
        }
        return components.get(tag);
      }
    }),
    AnimatePresence: ({ children }) => children,
    useReducedMotion: () => true
  };
});

vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));
vi.mock('../src/context/WalletContext', () => ({ useWallet: () => ({ address: state.evmAddress }) }));
vi.mock('../src/components/AnimatedIcon', () => ({ useStill: () => true }));
vi.mock('../src/components/AssetIcon', () => ({ default: () => null }));
vi.mock('../src/store/useAppStore', () => ({
  useAppStore: Object.assign((fn) => fn({}), { getState: () => ({ awardPoints: () => {} }) })
}));
vi.mock('../src/store/useSettingsStore', () => ({ useSettingsStore: (fn) => fn({ hideBalances: false }) }));

vi.mock('../src/lib/dln', async (original) => ({
  ...await original(),
  getDlnQuote: state.getDlnQuote,
  getDlnTx: state.getDlnTx
}));

vi.mock('../src/lib/solanaWallet', () => ({
  solanaAddress: () => state.address,
  signAndSendSolana: state.signAndSend,
  getSolanaBalance: state.getBalance
}));

import SolanaBridgePanel from '../src/components/SolanaBridgePanel';

/*
 * 0.1 SOL at $30 with a 0.005 SOL flat fee: the honest burden is 5.0%. The
 * bug made it 5,000,000,000.0% — same shape as the reported 1500000000.0%.
 */
const QUOTE = {
  toAmount: '98500',
  toAmountUsd: 0.0985,
  fromAmountUsd: 30,
  fixFee: '5000000',
  affiliateFee: { bps: 40, amount: '120000' },
  delaySec: 60
};

const advance = async (ms = 700) =>
  act(async () => { await vi.advanceTimersByTimeAsync(ms); await vi.dynamicImportSettled(); });

const setup = async (amount = '0.1') => {
  const utils = render(
    <MemoryRouter initialEntries={['/bridge']}>
      <SolanaBridgePanel />
    </MemoryRouter>
  );
  fireEvent.change(screen.getByLabelText(fa.bridge.solana.amount), { target: { value: amount } });
  await advance(700);
  return utils;
};

const sendButton = () => screen.getByRole('button', { name: new RegExp(fa.bridge.send) });

beforeEach(() => {
  vi.useFakeTimers();
  state.getDlnQuote.mockReset().mockResolvedValue(QUOTE);
  state.getDlnTx.mockReset().mockResolvedValue({ tx: { data: '0x0102' }, toAmount: '98500' });
  state.signAndSend.mockReset().mockResolvedValue('sig-abc');
  state.getBalance.mockReset().mockResolvedValue(1);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('shows the flat fee as its true percentage of the transfer, not a billionfold one', async () => {
  const { container } = await setup('0.1');

  const text = container.textContent;
  /* The corrected math: 0.005 SOL of a 0.1 SOL transfer is exactly 5.0%. */
  expect(text).toContain(t('bridge.solana.fixedFeeWarn', { pct: '5.0' }));
  /* …and the billionfold artefact is gone, in every shape it could take. */
  expect(text).not.toContain('5000000000');
  expect(text).not.toContain('1500000000');
  expect(text).not.toContain('e+');
  /* The fee row itself stays honest: 5,000,000 lamports is 0.005 SOL. */
  expect(text).toContain('0.005 SOL');
});

it('fails BEFORE the wallet opens, with the real reason, when SOL cannot cover amount + fee', async () => {
  state.getBalance.mockResolvedValue(0); /* 0 SOL, asked to bridge 0.1 + 0.005 fee */
  const { container } = await setup('0.1');

  await act(async () => { fireEvent.click(sendButton()); await Promise.resolve(); });

  expect(container.textContent).toContain(fa.bridge.solana.insufficientBalance);
  /* Nothing was built, nothing was offered to a wallet. */
  expect(state.getDlnTx).not.toHaveBeenCalled();
  expect(state.signAndSend).not.toHaveBeenCalled();
});

it('names a wallet rejection instead of the generic "transaction was not sent"', async () => {
  state.signAndSend.mockRejectedValue(new Error('REJECTED'));
  const { container } = await setup('0.1');

  await act(async () => { fireEvent.click(sendButton()); await Promise.resolve(); });

  expect(container.textContent).toContain(fa.solana.err.REJECTED);
  expect(container.textContent).not.toContain(fa.bridge.solana.sendFailed);
});

it('maps the order-build failure code to a readable reason', async () => {
  state.getDlnTx.mockRejectedValue(Object.assign(new Error('low balance'), { code: 'INSUFFICIENT_BALANCE' }));
  const { container } = await setup('0.1');

  await act(async () => { fireEvent.click(sendButton()); await Promise.resolve(); });

  expect(container.textContent).toContain(fa.solana.err.INSUFFICIENT_BALANCE);
  expect(state.signAndSend).not.toHaveBeenCalled();
});

it('sends a well-funded order and shows the signature link', async () => {
  await setup('0.1');

  await act(async () => { fireEvent.click(sendButton()); await Promise.resolve(); });

  /* The order is built as base58 sender + typed amount in base units. */
  expect(state.getDlnTx).toHaveBeenCalledWith(expect.objectContaining({
    srcChainId: 7565164,
    srcChainTokenInAmount: '100000000', /* 0.1 SOL in lamports, exact */
    senderAddress: state.address,
    dstChainTokenOutRecipient: state.evmAddress
  }));
  expect(state.signAndSend).toHaveBeenCalledTimes(1);
  await advance(3600); /* the explorer link appears after its short delay */
  expect(screen.queryByText('sig-abc')).toBeTruthy();
});
