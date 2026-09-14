// @vitest-environment jsdom
/**
 * «درگاه پرداخت باکس انتخاب توکن و شبکه مدرن شود و صفحه لتدینگ هم مدرن و خاص
 * باشد و لوگو ما وقتی روش میزنی وارد سایت ما شود.»
 *
 * THREE THINGS THIS FILE PINS:
 *
 *   1. THE MERCHANT'S NETWORK AND TOKEN PICKERS ARE THE APP'S MODERN PICKER.
 *      They were native `<select>` boxes — the one control on a payment screen
 *      that cannot show the two things a payer actually verifies: which network
 *      (every EVM chain reuses the same 0x address, so "the wrong network" is
 *      how a payment is lost) and which token (USDT on BSC is not USDT on
 *      Ethereum). Both now render through ModernSelect with the network mark
 *      and the token's own artwork.
 *
 *   2. THE LANDING'S LOGO IS A LINK TO OUR SITE. It was a decorative `<div>`:
 *      the one element on a payment page that looks tappable did nothing. It
 *      must point at the canonical host — `publicAppUrl('/')`, i.e.
 *      https://fbtswap.ir — and NOT at `window.location`, which inside the
 *      Android APK is `https://localhost`.
 *
 *   3. THE LANDING ANSWERS ITS ONE QUESTION FIRST. A payer opens this page to
 *      learn "how much, in what, on which network", so the amount is the hero
 *      and the token/network carry their own marks instead of a sentence.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import en from '../src/i18n/locales/en.json';

let language = 'en';
const t = (key, values = {}) => {
  const text = key.split('.').reduce((o, k) => o?.[k], en) ?? values.defaultValue ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language, changeLanguage: () => {} } }) }));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));
/* Switchable, because the landing has two honest states and both matter:
   a payer with no wallet yet must be told the payment happens in Trust, and a
   connected payer must see the exact amount they are about to sign. */
const walletState = { connected: true };
vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => ({
    isConnected: walletState.connected,
    address: walletState.connected ? '0x1111111111111111111111111111111111111111' : null,
    chainId: 56, mode: 'local', locked: false, getSigner: () => null
  }),
  shortAddress: (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`
}));
vi.mock('../src/i18n', () => ({ setLanguage: () => {}, default: {} }));

import PayGatewayPanel from '../src/components/PayGatewayPanel';
import PayLanding from '../src/pages/PayLanding';
import { encodePayPayload } from '../src/lib/payLink';

const fill = (text, values = {}) => String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');

beforeEach(() => {
  language = 'en';
  walletState.connected = true;
  Element.prototype.scrollIntoView = vi.fn();
  // The ModernSelect sheet renders into the document body.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the merchant payment gateway', () => {
  /*
   * The network and token pickers live inside the collapsible «payment» box,
   * which starts closed — so the test opens it the way a merchant does instead
   * of reaching past the UI.
   */
  const openPanel = () => {
    const utils = render(<MemoryRouter><PayGatewayPanel /></MemoryRouter>);
    const head = [...utils.container.querySelectorAll('.infobox-head')]
      .find((b) => b.textContent.includes(en.pay.section.payment));
    fireEvent.click(head);
    return utils;
  };

  it('picks the network and the token through the app’s modern picker', () => {
    const { container } = openPanel();
    const network = screen.getByTestId('pay-network-select');
    const token = screen.getByTestId('pay-token-select');
    // Both are the ModernSelect trigger, not a native dropdown.
    expect(network.querySelector('.modern-select-trigger')).toBeTruthy();
    expect(token.querySelector('.modern-select-trigger')).toBeTruthy();
    expect(container.querySelector('select')).toBeNull();
    // The trigger names the network and shows its mark, so the choice is
    // visible before the sheet is opened.
    expect(network.textContent).toContain('BNB Smart Chain');
    expect(network.querySelector('.modern-select-icon svg')).toBeTruthy();
    expect(token.querySelector('.modern-select-icon svg')).toBeTruthy();
    // …and the gas coin of the chosen network is stated, because a payer who
    // holds no BNB cannot complete the transfer the link asks for.
    expect(container.textContent).toContain(fill(en.pay.gasNote, { gas: 'BNB' }));
  });

  const pick = async (testId, label) => {
    const box = screen.getByTestId(testId);
    fireEvent.click(box.querySelector('.modern-select-trigger'));
    const row = await screen.findByText(label);
    fireEvent.click(row.closest('.modern-select-option') || row);
  };

  it('keeps a token that exists on the newly chosen network', async () => {
    openPanel();
    const tokenLabel = () => screen.getByTestId('pay-token-select').querySelector('.modern-select-label').textContent;
    // BNB Smart Chain's own coin is the default row.
    expect(tokenLabel()).toBe('BNB');
    await pick('pay-token-select', 'USDT');
    await waitFor(() => expect(tokenLabel()).toBe('USDT'));

    await pick('pay-network-select', 'Ethereum');
    await waitFor(() => {
      // USDT exists on both networks, so the merchant's choice must survive the
      // switch — a picker that silently resets the token makes merchants build
      // the wrong link and notice only when a customer cannot pay.
      expect(tokenLabel()).toBe('USDT');
    });
    expect(screen.getByTestId('pay-network-select').textContent).toContain('Ethereum');
  });

  it('replaces a token the new network does not have, instead of leaving a dead link', async () => {
    openPanel();
    const tokenLabel = () => screen.getByTestId('pay-token-select').querySelector('.modern-select-label').textContent;
    expect(tokenLabel()).toBe('BNB');
    await pick('pay-network-select', 'Ethereum');
    await waitFor(() => {
      /* There is no BNB ERC-20 in this app's Ethereum list. Leaving BNB
         selected would encode a link whose transfer can never be built — the
         picker swaps to that chain's own coin and the merchant sees it. */
      expect(tokenLabel()).toBe('ETH');
    });
  });
});

describe('the customer landing page', () => {
  const code = encodePayPayload({
    to: '0x2222222222222222222222222222222222222222',
    chainId: 56,
    token: 'USDT',
    amount: '25',
    lang: 'en',
    theme: 'mint',
    name: 'Fanous Coffee'
  });

  /*
   * Rendered through a real `/pay/:code` route, not as a bare component: the
   * page reads its code from `useParams()`, and mounting it outside a Route
   * hands it no code at all — which renders the "link is not valid" branch and
   * would make every assertion below pass for the wrong reason.
   */
  const mount = (route = `/pay/${code}`) => render(
    <MemoryRouter initialEntries={[route]}>
      <Routes><Route path="/pay/:code" element={<PayLanding />} /></Routes>
    </MemoryRouter>
  );

  it('makes the logo a link to our site — the canonical host, not window.location', () => {
    mount();
    const brand = screen.getByTestId('pay-landing-brand-link');
    // An <a>, not a div: it has to be tappable and keyboard-reachable.
    expect(brand.tagName).toBe('A');
    expect(brand.getAttribute('href')).toBe('https://fbtswap.ir/');
    expect(brand.getAttribute('aria-label')).toBe(en.pay.landing.brandLink);
  });

  it('says where the logo goes when the link is broken or unreadable', () => {
    // The invalid-code branch is what a payer sees when a QR is truncated —
    // and it is exactly when the way back to the site matters most.
    mount('/pay/not-a-real-code');
    expect(screen.getByText(en.pay.landing.invalid)).toBeTruthy();
    expect(screen.getByTestId('pay-landing-brand-link').getAttribute('href')).toBe('https://fbtswap.ir/');
  });

  it('leads with the amount, and marks the token and the network', () => {
    const { container } = mount();
    expect(container.querySelector('.pay-landing-hero .pay-landing-amount').textContent).toContain('25');
    expect(container.querySelector('.pay-landing-hero .pay-landing-amount-sym').textContent).toBe('USDT');
    // Two marks, each with its own artwork: the token and its network.
    const marks = [...container.querySelectorAll('.pay-landing-mark')];
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe('USDT');
    expect(marks[1].textContent).toContain('BNB Smart Chain');
    expect(marks.every((m) => m.querySelector('svg'))).toBe(true);
    // The merchant's name is the identity the payer is paying.
    expect(container.textContent).toContain('Fanous Coffee');
  });

  it('keeps the honest facts: recipient and the fee, before any wallet exists', () => {
    const { container } = mount();
    expect(container.textContent).toContain('0x2222…2222');
    /* The fee string carries a `{{fee}}` placeholder that the app's i18n
       instance fills globally with the real platform fee; this test's `t`
       stands in for that interpolation, so compare against the same shape. */
    expect(container.textContent).toContain(fill(en.pay.landing.fee));
  });

  it('offers Trust Wallet first, and says the signature happens there', () => {
    walletState.connected = false;
    const { container } = mount();
    expect(screen.getByText(en.pay.landing.connect)).toBeTruthy();
    expect(container.textContent).toContain(en.pay.landing.trustHint);
  });

  it('shows a connected payer the exact amount they are about to sign', () => {
    const { container } = mount();
    /* 25 USDT, six decimals — the button names the real number, not a rounded
       or dollar-converted one. Queried by class rather than by text because the
       page's own title is also the word "Pay", and an ambiguous match would
       let this test pass against the heading instead of the button. */
    const cta = container.querySelector('.pay-landing-btn');
    expect(cta.textContent).toContain(en.pay.landing.pay);
    expect(cta.textContent).toContain('25 USDT');
    expect(container.textContent).toContain('BNB Smart Chain');
  });
});
