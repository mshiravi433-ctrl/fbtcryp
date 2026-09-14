// @vitest-environment jsdom
/**
 * «مطمئن شو ارسال و دریافت توکن کار میده» — THE RECEIVE HALF.
 *
 * The send half is proven on a real chain in test/inapp-wallet-transfers.test.js.
 * This file proves the other half: the address and the QR a payer is handed.
 *
 * Why the QR is decoded rather than merely rendered:
 *   A subtly wrong QR encoder still produces a scannable square — it just
 *   decodes to DIFFERENT CHARACTERS. For a wallet address that means funds sent
 *   to an address nobody controls, permanently, with this app confidently
 *   showing the code that caused it. So the module matrix this sheet paints is
 *   turned into a bitmap and pushed through jsQR — the independent decoder the
 *   app's own SCANNER uses. Encode here, decode there: if the two ever disagree,
 *   this test fails instead of a customer's deposit.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import jsQR from 'jsqr';
import en from '../src/i18n/locales/en.json';

const t = (key, values = {}) => {
  const text = key.split('.').reduce((o, k) => o?.[k], en) ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'en' } }) }));
vi.mock('framer-motion', () => {
  const components = new Map();
  return {
    motion: new Proxy({}, {
      get: (_, tag) => {
        if (!components.has(tag)) {
          components.set(tag, ({ children, ...props }) => {
            const Tag = String(tag);
            const clean = Object.fromEntries(Object.entries(props).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(k)));
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

/* The wallet state the sheet reads. `mode: 'local'` is the in-app wallet, which
   is also the only mode with a bitcoin address derived from the same phrase. */
const walletState = { address: null, chainId: 56, mode: 'local', locked: false };
vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => ({
    address: walletState.address,
    chainId: walletState.chainId,
    mode: walletState.mode,
    locked: walletState.locked,
    getSigner: () => null
  })
}));
vi.mock('../src/store/useAppStore', () => ({ useAppStore: () => () => {} }));
// The bitcoin leg derives from a live signer; this suite is about the EVM half.
vi.mock('../src/lib/btcWallet', () => ({ btcAddressForSigner: async () => null }));

import ReceiveSheet from '../src/components/ReceiveSheet';

/*
 * The sheet renders through a portal into document.body (that is what makes it
 * centre correctly inside transformed page wrappers), so every query below goes
 * to the body rather than to the render container.
 */
const root = () => document.body;

const ADDRESS = '0x66c14A85E3f0ab12508F5289A3041BEdE1EaE1DE';

beforeEach(() => {
  walletState.address = ADDRESS;
  walletState.chainId = 56;
  walletState.mode = 'local';
  walletState.locked = false;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/**
 * Rasterise the painted SVG path into RGBA and decode it with jsQR.
 * The path is a run of `M{x} {y}h1v1h-1z` unit squares, one per dark module.
 */
function decodePaintedQr(pathEl, scale = 6) {
  const d = pathEl.getAttribute('d') || '';
  const modules = [...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [Number(m[1]), Number(m[2])]);
  expect(modules.length).toBeGreaterThan(50);
  const count = Math.max(...modules.map(([x]) => x)) + 1;
  const quiet = 4; // the sheet relies on its white padding for the quiet zone
  const size = (count + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (const [mx, my] of modules) {
    for (let y = 0; y < scale; y += 1) {
      for (let x = 0; x < scale; x += 1) {
        const px = ((my + quiet) * scale + y) * size + (mx + quiet) * scale + x;
        data[px * 4] = 0; data[px * 4 + 1] = 0; data[px * 4 + 2] = 0; data[px * 4 + 3] = 255;
      }
    }
  }
  return jsQR(data, size, size);
}

describe('the receive sheet', () => {
  it('shows the wallet’s own address, chunked so it can be read aloud', () => {
    render(<ReceiveSheet open onClose={() => {}} />);
    const shown = root().querySelector('.recv-addr').textContent;
    expect(shown.replace(/\s+/g, '')).toBe(ADDRESS);
    // 4-character groups, not a wall of hex.
    expect(shown).toContain('0x66 c14A');
    // Copy takes the ADDRESS alone — never a prefixed URI a sender's wallet
    // might fail to parse.
    expect(shown).not.toContain('ethereum:');
  });

  it('paints a QR that decodes back to exactly that address', () => {
    render(<ReceiveSheet open onClose={() => {}} />);
    const path = root().querySelector('.recv-qr svg path');
    expect(path).toBeTruthy();
    const decoded = decodePaintedQr(path);
    expect(decoded, 'the painted QR must be decodable at all').toBeTruthy();
    expect(decoded.data).toBe(ADDRESS);
  });

  it('shouts the network the address is valid on', () => {
    render(<ReceiveSheet open onClose={() => {}} />);
    expect(root().querySelector('.recv-net-pill').textContent).toContain('BNB Smart Chain');
    expect(root().textContent).toContain(en.receive.warning);
  });

  it('names the network it is showing when the wallet sits on another chain', () => {
    /* The same 0x address exists on every EVM chain, so the network line is
       the only thing standing between a payer and a lost deposit. It must
       follow the wallet, not a hard-coded default. */
    walletState.chainId = 8453;
    render(<ReceiveSheet open onClose={() => {}} />);
    expect(root().querySelector('.recv-net-pill').textContent).toContain('Base');
  });

  it('says to connect first, and shows no QR, when there is no wallet', () => {
    walletState.address = null;
    render(<ReceiveSheet open onClose={() => {}} />);
    expect(root().textContent).toContain(en.receive.connectFirst);
    expect(root().querySelector('.recv-qr')).toBeNull();
  });

  it('offers the bitcoin address of the same vault only while it is unlocked', () => {
    const { rerender } = render(<ReceiveSheet open onClose={() => {}} />);
    // Unlocked local vault: the BTC section is present (its address derives
    // from the in-memory phrase).
    expect(root().textContent).toContain(en.receive.btc.title);
    expect(root().textContent).toContain(en.receive.btc.backupCovered);

    // Locked: no phrase in memory, so no address — and the sheet SAYS so rather
    // than rendering nothing, which reads as "this app has no bitcoin address".
    walletState.locked = true;
    rerender(<ReceiveSheet open onClose={() => {}} />);
    expect(root().textContent).toContain(en.receive.btc.locked);

    // An external wallet has no phrase here at all, so no bitcoin section.
    walletState.mode = 'wc';
    rerender(<ReceiveSheet open onClose={() => {}} />);
    expect(root().textContent).not.toContain(en.receive.btc.title);
  });
});
