// @vitest-environment jsdom
/**
 * TAP TO PAY + THE P2P DESK, MOUNTED.
 * ---------------------------------------------------------------------------
 * «پرداخت با نزدیک تر کردن گوشی را خیلی مدرن کن با کیو ار کد جذاب تر و کارایی
 * را بهتر کن که مطمئن شی کار میده حتما» — make it modern, make the QR
 * beautiful, and be SURE it works.
 *
 * "Be sure it works" is the part this file is for. A prettier QR is worthless
 * if the code behind it does not decode to the receiver's address, so the
 * matrix painted on the screen is rasterised and pushed through a real QR
 * decoder (jsQR — the independent implementation, not our own encoder), the
 * same way test/fancy-qr.test.jsx checks the receive sheets. A QR that scans
 * to the wrong string is a payment to an address nobody controls.
 *
 * Also pinned here:
 *
 *   — The network is NAMED on the face of the card. Every EVM chain reuses the
 *     same 0x address, so "wrong network" is how an in-person payment is lost,
 *     and the old screen never showed it.
 *   — An amount is carried INSIDE the code only when it is denominated in the
 *     chain's own coin. The token form of EIP-681 puts the token contract where
 *     every parser reads the recipient, so encoding a USDT request that way
 *     would pay the contract. The amount must stay on screen instead.
 *   — A scanned address from another chain is called out before the wallet is
 *     opened. After signing is too late.
 *   — Nothing was sent. The one sentence that must survive every redesign.
 *   — The P2P hero's animated logo renders, and the page's three tabs switch.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import jsQR from 'jsqr';
import en from '../src/i18n/locales/en.json';
import fa from '../src/i18n/locales/fa.json';
import ar from '../src/i18n/locales/ar.json';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

const t = (key, values = {}) => {
  const text = key.split('.').reduce((o, k) => o?.[k], en) ?? values.defaultValue ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: () => {} } })
}));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));
vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => ({
    isConnected: true,
    address: OWNER,
    chainId: 56,
    chain: { name: 'BNB Smart Chain' },
    chainOk: true,
    mode: 'local',
    locked: false,
    /* Resolves to null: the watcher is a network feature, and this suite is
       about what is ON SCREEN. Returning null is also the honest path a phone
       with no reachable RPC takes, so the UI must survive it. */
    getReadProvider: () => Promise.resolve(null)
  }),
  shortAddress: (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`
}));
vi.mock('../src/i18n', () => ({ setLanguage: () => {}, default: {} }));

import TapToPay from '../src/components/TapToPay';
import P2P from '../src/pages/P2P';
import { buildPayLink, parsePayLink, parseUnits, formatUnits } from '../src/lib/tapToPay';

/** Rasterise the modules the component painted, then decode them with jsQR. */
function decodePaintedQr(svgEl, { scale = 5 } = {}) {
  const path = svgEl.querySelector('path');
  const d = path?.getAttribute('d') || '';
  const modules = [...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [Number(m[1]), Number(m[2])]);
  expect(modules.length).toBeGreaterThan(50);
  const count = Math.max(...modules.map(([x]) => x)) + 1;
  const quiet = 4;
  const size = (count + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  const px = (n) => Math.round(n * scale);
  for (const [mx, my] of modules) {
    for (let y = px(my + quiet); y < px(my + quiet + 1); y += 1) {
      for (let x = px(mx + quiet); x < px(mx + quiet + 1); x += 1) {
        const i = (y * size + x) * 4;
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
      }
    }
  }
  return jsQR(data, size, size);
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the amount inside the payment code', () => {
  it('converts a human amount to base units without floating-point drift', () => {
    /* 0.07 * 1e18 in floating point is 7.000000000000001e16 — rounding a
       payment amount is how somebody is quietly charged the wrong number. */
    expect(parseUnits('0.07', 18).toString()).toBe('70000000000000000');
    expect(parseUnits('1', 18).toString()).toBe('1000000000000000000');
    expect(parseUnits('25.5', 6).toString()).toBe('25500000');
    /* "1." is a number mid-keystroke on the way to "1.5". It reads as 1
       rather than as an error, so the amount does not blink out of the code
       and back while it is being typed. */
    expect(parseUnits('1.', 18).toString()).toBe('1000000000000000000');
    /* But these are rejected outright rather than truncated: silence is the
       recoverable mistake, a confidently wrong number is not. */
    expect(parseUnits('', 18)).toBeNull();
    expect(parseUnits('.', 18)).toBeNull();
    expect(parseUnits('-1', 18)).toBeNull();
    expect(parseUnits('1e3', 18)).toBeNull();
    expect(formatUnits('70000000000000000', 18)).toBe('0.07');
    expect(formatUnits('25500000', 6)).toBe('25.5');
  });

  it('carries a native-coin amount in the code, and refuses to encode a token amount', () => {
    const native = buildPayLink(OWNER, 56, { amount: '0.05', decimals: 18, native: true });
    expect(native).toBe(`ethereum:${OWNER}@56?value=50000000000000000`);

    /* USDT on BSC is 18 decimals in this app's registry, but it is NOT the
       chain's own coin — and the ERC-20 form of EIP-681 puts the token
       contract in the position every parser reads as the recipient. So an
       amount in a token is never emitted; it stays on screen. */
    const tokenAmount = buildPayLink(OWNER, 56, { amount: '12', decimals: 18 });
    /* …and it stays silent even when the caller forgets to SAY it is a token,
       because the safe default is "do not encode". */
    const forgotten = buildPayLink(OWNER, 56, { amount: '12', decimals: 18, native: false });
    expect(forgotten).toBe(`ethereum:${OWNER}@56`);
    expect(tokenAmount).toBe(`ethereum:${OWNER}@56`);
    expect(tokenAmount).not.toContain('value=');
  });

  it('reads a requested amount back out of a scanned link', () => {
    const parsed = parsePayLink(`ethereum:${OTHER}@56?value=250000000000000000`);
    expect(parsed.address).toBe(OTHER);
    expect(parsed.chainId).toBe(56);
    expect(parsed.value).toBe('250000000000000000');
    expect(formatUnits(parsed.value, 18)).toBe('0.25');
  });
});

describe('the tap-to-pay surface', () => {
  const mount = () => render(<TapToPay onAddress={() => {}} />);

  it('paints a QR that really decodes to the receiver’s own address', () => {
    const { container } = mount();
    const svg = container.querySelector('.tap-qr svg');
    expect(svg).toBeTruthy();

    const decoded = decodePaintedQr(svg);
    expect(decoded).toBeTruthy();
    /* The whole point of the feature: the other phone reads OUR address, on
       OUR chain, without a single character being typed. */
    expect(decoded.data).toBe(`ethereum:${OWNER}@56`);
    expect(parsePayLink(decoded.data).address).toBe(OWNER);
  });

  it('names the network on the face of the card', () => {
    const { container } = mount();
    expect(container.querySelector('.tap-network').textContent).toContain('BNB Smart Chain');
    expect(container.textContent).toContain(en.tap.networkHint);
  });

  it('offers share, copy-link and copy-address as three separate controls', () => {
    mount();
    /* Three actions, not one: "copy" alone does not say WHAT was copied, and
       the address is what a person pastes into their own wallet. */
    expect(screen.getByText(en.tap.share)).toBeTruthy();
    expect(screen.getByText(en.tap.copyLink)).toBeTruthy();
    expect(screen.getByText(en.tap.copyAddress)).toBeTruthy();
  });

  it('puts the amount in the code for the network coin, and only on screen for a token', async () => {
    const { container } = mount();
    const amountInput = container.querySelector('.tap-watch-amount input');
    const select = container.querySelector('.tap-watch-field select');
    expect(select).toBeTruthy();

    // BNB is BSC's own coin, so the default row is the native one.
    await act(async () => fireEvent.change(amountInput, { target: { value: '0.05' } }));
    expect(container.querySelector('.tap-request').className).toContain('is-in-code');
    const decoded = decodePaintedQr(container.querySelector('.tap-qr svg'));
    expect(decoded.data).toBe(`ethereum:${OWNER}@56?value=50000000000000000`);

    // Switch to USDT: the number stays visible, and leaves the code.
    await act(async () => fireEvent.change(select, { target: { value: 'USDT' } }));
    expect(container.querySelector('.tap-request').className).not.toContain('is-in-code');
    expect(container.textContent).toContain(en.tap.amountOnScreenOnly);
    const decoded2 = decodePaintedQr(container.querySelector('.tap-qr svg'));
    expect(decoded2.data).toBe(`ethereum:${OWNER}@56`);
  });

  it('shows what the other phone is asking for, and warns when their chain is not ours', async () => {
    const { container } = mount();
    await act(async () => fireEvent.click(screen.getByText(en.tap.iPay)));

    const input = container.querySelector('.tap-paste-row input');
    await act(async () => fireEvent.change(input, { target: { value: `ethereum:${OTHER}@1?value=250000000000000000` } }));
    await act(async () => fireEvent.click(screen.getByText(en.common.confirm)));

    expect(container.textContent).toContain('0.25 ETH');
    /* Their address is on Ethereum, we are on BSC. Named BEFORE the wallet is
       opened — after signing there is nothing to be done about it. */
    const warn = container.querySelector('.tap-got-warn');
    expect(warn).toBeTruthy();
    expect(warn.textContent).toContain('Ethereum');
    expect(warn.textContent).toContain('BNB Smart Chain');
    /* And the one sentence that must survive every redesign. */
    expect(container.textContent).toContain(en.tap.nothingSentYet);
  });

  /*
   * The likeliest way this screen fails in real life is not the encoder — it
   * is the phone dimming and locking while someone is holding it up across a
   * counter. A dark screen scans exactly as well as no screen.
   */
  it('holds a screen wake lock only while a code is on screen', async () => {
    let held = 0;
    let released = 0;
    const lock = { release: () => { released += 1; return Promise.resolve(); } };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: () => { held += 1; return Promise.resolve(lock); } }
    });

    const { container } = mount();
    await act(async () => {});
    expect(held).toBe(1);

    // Switching away from the code must let the phone sleep again.
    await act(async () => fireEvent.click(screen.getByText(en.tap.iPay)));
    expect(released).toBe(1);

    // …and coming back re-acquires it, because the OS does not hand it back.
    await act(async () => fireEvent.click(screen.getByText(en.tap.iReceive)));
    await act(async () => {});
    expect(held).toBe(2);
    expect(container.querySelector('.tap-qr svg')).toBeTruthy();

    delete navigator.wakeLock;
  });

  it('survives a platform with no wake lock at all', async () => {
    /* Older WebViews and desktop Firefox have no Screen Wake Lock. That is a
       no-op, not an error: the code is still on screen, it just does not get
       the extra courtesy. */
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    const { container } = mount();
    await act(async () => {});
    expect(container.querySelector('.tap-qr svg')).toBeTruthy();
    delete navigator.wakeLock;
  });

  it('keeps the scanner as the first action on the paying side', async () => {
    const { container } = mount();
    await act(async () => fireEvent.click(screen.getByText(en.tap.iPay)));
    const buttons = [...container.querySelectorAll('.tap-body button')];
    /* NFC reaches ~6% of browsers and 0% of iPhones; leading with it would put
       the unusable option first for almost everyone. */
    expect(buttons[0].textContent).toContain(en.tap.scanCode);
  });
});

describe('the P2P desk', () => {
  it('renders the animated hero logo, and switches between all three routes', async () => {
    const errors = [];
    const realError = console.error;
    console.error = (...args) => { errors.push(String(args[0])); realError(...args); };
    try {
      const { container } = render(<MemoryRouter><P2P /></MemoryRouter>);
      /* The logo was requested as «در باکس بالایی لوگو اگر انیمیشنی بشه بهتره».
         It is a real SVG mark with its own moving parts, not a scaled glyph. */
      const mark = container.querySelector('.p2p-mark');
      expect(mark).toBeTruthy();
      expect(mark.querySelector('.p2p-mark-glyph')).toBeTruthy();
      expect(mark.querySelectorAll('.p2p-mark-orbit').length).toBe(2);

      /* Queried as tabs, not by text: "On-chain OTC" and "Pay" also appear as
         chips in the hero's route line, and getByText would match both. */
      for (const key of ['otc', 'pay', 'market']) {
        await act(async () => fireEvent.click(screen.getByRole('tab', { name: new RegExp(en.p2p.tab[key], 'i') })));
        const active = container.querySelector('#p2p-active-panel');
        expect(active).toBeTruthy();
        expect(container.querySelector(`#p2p-tab-${key}`).getAttribute('aria-selected')).toBe('true');
      }
      expect(errors).toEqual([]);
    } finally {
      console.error = realError;
    }
  });
});

describe('the new copy exists where it is rendered', () => {
  /* A key present in en but missing from fa falls back to English MID-SENTENCE,
     which reads as a rendering fault rather than a translation gap. */
  const flat = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) =>
      v && typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]);

  const newKeys = [
    'tap.share', 'tap.copyLink', 'tap.copyAddress', 'tap.enlarge', 'tap.enlargeHint',
    'tap.network', 'tap.networkHint', 'tap.amount', 'tap.amountPlaceholder',
    'tap.amountInCode', 'tap.amountOnScreenOnly', 'tap.nativeCoin', 'tap.watchOffline',
    'tap.scanningHint', 'tap.theyAsk', 'tap.chainMismatch'
  ];

  for (const key of newKeys) {
    it(`${key} exists in en, fa and ar`, () => {
      for (const [name, dict] of [['en', en], ['fa', fa], ['ar', ar]]) {
        expect(flat(dict), `${name} is missing ${key}`).toContain(key);
      }
    });
  }

  it('arabic carries the whole tap screen, not half of it', () => {
    const enTap = new Set(flat(en.tap));
    const arTap = new Set(flat(ar.tap));
    /* Sixteen Arabic lines among twenty-one English ones reads as a bug, so the
       section was completed rather than extended. */
    expect([...enTap].filter((k) => !arTap.has(k))).toEqual([]);
  });
});
