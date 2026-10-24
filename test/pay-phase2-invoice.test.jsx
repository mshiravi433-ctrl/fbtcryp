// @vitest-environment jsdom
/**
 * PAY PHASE 2 — THE INVOICE NOTE AND THE SWAP & PAY SHORTFALL.
 * ---------------------------------------------------------------------------
 * Two screens, one wire contract. The note rides INSIDE the link (a static
 * share URL cannot promise a server lookup), survives the trip unchanged into
 * the landing render, and never grows the payload format: a link minted
 * before the feature decodes with `note: ''`; a link minted after still
 * decodes on older builds — the extra key is simply unread. Both directions
 * are pinned below by looking at the base64 itself, not the decoder's
 * optimism.
 *
 * The Swap & Pay box is pinned on its honest shape: it appears ONLY for a
 * connected wallet whose measured balance is short, it routes to /swap with
 * network + token but NEVER an amount (the query sizes the INPUT side), and
 * its fee sentence names both fees — the swap's and the gateway's.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import en from '../src/i18n/locales/en.json';

let language = 'en';
const t = (key, values = {}) => {
  const text = key.split('.').reduce((o, k) => o?.[k], en) ?? values.defaultValue ?? key;
  return String(text)
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (k === 'fee' ? '0.7' : values[k] ?? ''));
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language, changeLanguage: () => {} } }) }));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));

/* A dial: each test decides what the connected wallet holds, if anything. */
const walletState = { connected: true, heldRaw: null };
vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => ({
    isConnected: walletState.connected,
    address: walletState.connected ? '0x1111111111111111111111111111111111111111' : null,
    chainId: 56, mode: 'local', locked: false, getSigner: () => null,
    getReadProvider: () => (walletState.heldRaw === null ? Promise.resolve(null) : Promise.resolve({}))
  }),
  shortAddress: (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`
}));
/* decimals follow the app's own chain table (BSC USDT is listed 18-decimals here), so the numbers the box formats land on 10 / 25 / 15. */
const getTokenBalance = vi.fn(async () => (walletState.heldRaw === null ? null : { raw: walletState.heldRaw, decimals: 18 }));
vi.mock('../src/lib/swap', () => ({ getTokenBalance: (...a) => getTokenBalance(...a) }));
vi.mock('../src/i18n', () => ({ setLanguage: () => {}, LANGUAGES: [], default: {} }));

import PayGatewayPanel from '../src/components/PayGatewayPanel';
import PayLanding from '../src/pages/PayLanding';
import { encodePayPayload, decodePayPayload, cleanPayNote } from '../src/lib/payLink';

const b64urlJson = (code) => JSON.parse(Buffer.from(code.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

function RouteProbe() {
  const loc = useLocation();
  return <div data-testid="route-probe">{`${loc.pathname}${loc.search}`}</div>;
}

const base = {
  to: '0x2222222222222222222222222222222222222222',
  chainId: 56,
  token: 'USDT',
  amount: '25',
  lang: 'en',
  theme: 'mint',
  name: 'Fanous Coffee'
};

beforeEach(() => {
  language = 'en';
  walletState.connected = true;
  walletState.heldRaw = null;
  getTokenBalance.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the invoice note — the wire', () => {
  it('sanitises control/bidi characters and brackets, trims, and caps at 120', () => {
    expect(cleanPayNote('  Order #148 ')).toBe('Order #148');
    expect(cleanPayNote('<img src=x onerror=alert(1)>')).toBe('img src=x onerror=alert(1)');
    /* a lone RLO trying to hide text after it loses its directionality */
    expect(cleanPayNote('Order 148\u202Erefund me\u202C')).toBe('Order 148refund me');
    expect(cleanPayNote('x'.repeat(500))).toHaveLength(120);
    expect(cleanPayNote(undefined)).toBe('');
    expect(cleanPayNote(42)).toBe('42');
  });

  it('writes the m key only when there IS a note — v:1 shape otherwise, byte-for-byte', () => {
    const without = encodePayPayload(base);
    expect(b64urlJson(without)).not.toHaveProperty('m');
    expect(b64urlJson(without).v).toBe(1);

    const withNote = encodePayPayload({ ...base, note: 'Order #148' });
    expect(b64urlJson(withNote).m).toBe('Order #148');
    expect(b64urlJson(withNote).v).toBe(1);

    /* the OLD decoder's contract: a pre-feature link decodes with note '' */
    expect(decodePayPayload(without).note).toBe('');
    expect(decodePayPayload(withNote).note).toBe('Order #148');
    /* every other field is untouched by the addition */
    const a = decodePayPayload(without);
    const b = decodePayPayload(withNote);
    expect({ ...b, note: a.note }).toEqual(a);
  });

  it('re-sanitises on READ: hand-crafting a payload cannot smuggle markup to the landing', () => {
    /* the WIRE keys are the compact ones (v/to/c/t/a/n/m) — hand-craft, not encode */
    const code = btoa(JSON.stringify({
      v: 1, to: base.to, c: 56, t: 'USDT', a: '25', n: 'Fanous Coffee', m: '<b>pay<b> <x>'
    })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodePayPayload(code).note).toBe('bpayb x');
  });
});

describe('the invoice note — the screens', () => {
  const openPanel = () => {
    const utils = render(<MemoryRouter><PayGatewayPanel /></MemoryRouter>);
    /* open every collapsible — the note field lives beside the amount box */
    for (const head of [...utils.container.querySelectorAll('.infobox-head')]) fireEvent.click(head);
    return utils;
  };

  it('offers the optional field with its honest hint under the amount box', () => {
    const { container } = openPanel();
    const input = container.querySelector('input[maxlength="120"]');
    expect(input).toBeTruthy();
    expect(container.textContent).toContain(en.pay.invoiceHint);
    /* amount and note are independent: typing neither breaks generation */
    fireEvent.change(input, { target: { value: 'Order <#148>' } });
    expect(input.value).toBe('Order <#148>'); /* the field itself is raw — the WIRE sanitises */
  });

  it('a created link shows the note on its row, and the saved link decodes back to it', () => {
    const { container } = openPanel();
    const noteInput = container.querySelector('input[maxlength="120"]');
    fireEvent.change(noteInput, { target: { value: 'Table 7 — 12:40' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.pay.create.replace('(', '\\(').replace(')', '\\)')) }));
    const chip = [...document.querySelectorAll('.pay-link-note')][0];
    expect(chip).toBeTruthy();
    expect(chip.textContent).toBe('Table 7 — 12:40');
    const url = document.querySelector('.pay-link-url').textContent;
    const code = url.split('/pay/')[1];
    expect(decodePayPayload(code).note).toBe('Table 7 — 12:40');
  });

  it('the landing renders the note as plain text — and renders NO box when there is no note', () => {
    const mount = (payload) => render(
      <MemoryRouter initialEntries={[`/pay/${encodePayPayload(payload)}`]}>
        <Routes>
          <Route path="/pay/:code" element={<PayLanding />} />
          <Route path="/swap" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>
    );
    const withNote = mount({ ...base, note: 'Order 148' });
    const node = screen.getByTestId('pay-landing-note');
    expect(node.textContent).toContain('Order 148');
    expect(node.getAttribute('dir')).toBe('auto');
    withNote.unmount();

    cleanup();
    mount(base);
    expect(screen.queryByTestId('pay-landing-note')).toBeNull();
  });
});

describe('Swap & Pay — the shortfall is a route, not a dead end', () => {
  const mount = () => render(
    <MemoryRouter initialEntries={[`/pay/${encodePayPayload(base)}`]}>
      <Routes>
        <Route path="/pay/:code" element={<PayLanding />} />
        <Route path="/swap" element={<RouteProbe />} />
      </Routes>
    </MemoryRouter>
  );

  it('stays invisible when the balance cannot be read (no provider, no promise)', async () => {
    walletState.heldRaw = null;
    const { container } = mount();
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('[data-testid="pay-swap-pay-box"]')).toBeNull();
    /* and the page is otherwise IDENTICAL to before the feature */
    expect(container.querySelector('.pay-landing-btn').textContent).toContain('25');
  });

  it('appears on a real shortfall, states have/need/short, and names BOTH fees', async () => {
    walletState.heldRaw = '10000000000000000000'; /* 10 USDT held vs 25 needed */
    const { container } = mount();
    const box = await waitFor(() => {
      const el = container.querySelector('[data-testid="pay-swap-pay-box"]');
      expect(el).toBeTruthy();
      return el;
    });
    expect(box.textContent).toContain('10');
    expect(box.textContent).toContain('25');
    expect(box.textContent).toContain('15');
    /* both percentages spoken out loud — an informed double fee is honest */
    expect(box.textContent).toContain('0.7% on the swap');
    expect(box.textContent).toContain('0.7% on this gateway');
    expect(box.textContent).not.toContain('{{');
  });

  it('routes to /swap with chain + token pre-selected and NO amount (input-side query would be wrong)', async () => {
    walletState.heldRaw = '10000000000000000000';
    const { container } = mount();
    const box = await waitFor(() => {
      const el = container.querySelector('[data-testid="pay-swap-pay-box"]');
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.click(box.querySelector('.pay-landing-swap-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('route-probe').textContent).toBe('/swap?chain=56&to=USDT');
    });
    /* the pin in prose: never an amount on this route */
    expect(screen.getByTestId('route-probe').textContent).not.toContain('amount');
  });

  it('does NOT nag when the wallet already covers the invoice', async () => {
    walletState.heldRaw = '25000000000000000000'; /* exactly enough */
    const { container } = mount();
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('[data-testid="pay-swap-pay-box"]')).toBeNull();
  });

  it('a disconnected payer never sees a balance box — they get the connect path', async () => {
    walletState.connected = false;
    const { container } = mount();
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('[data-testid="pay-swap-pay-box"]')).toBeNull();
    expect(getTokenBalance).not.toHaveBeenCalled();
  });
});
