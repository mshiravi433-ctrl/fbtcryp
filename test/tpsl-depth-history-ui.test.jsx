// @vitest-environment jsdom
/**
 * UI tests for the three new surfaces, rendered for real:
 *   · DydxTpSlCard  — nothing is signed until the confirm click; an invalid plan
 *                     cannot be sent; each leg is one reduce-only request.
 *   · FuturesHistory — read-only table; Ostium and Velocity are labelled and
 *                     linked to their existing screens; no NaN is shown.
 *   · SpotDepth      — quotes are labelled non-binding; the fetch is debounced;
 *                     a failed point is shown as unavailable.
 *
 * The dYdX module, the network and the router are replaced. Every replaced
 * function is a counter, so the assertions read as «this many signatures».
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EN from '../src/i18n/locales/en.json';

/* t() answers with the key itself, so assertions read the translation keys. */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'en', changeLanguage: () => {} }
  })
}));

/* Opt into the v7 behaviour now, so the test output stays free of router warnings. */
const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

const VALID_ADDR = `dydx1${'a'.repeat(38)}`;

const dydxMock = vi.hoisted(() => ({
  place: vi.fn(async () => ({ hash: '0xabc', clientId: 1 })),
  cancel: vi.fn(async () => ({ hash: '0xdef', clientId: 1 })),
  orders: vi.fn(async () => ({ orders: [], live: true })),
  fills: vi.fn(async () => ({ fills: [], live: true })),
  session: { address: null }
}));
vi.mock('../src/lib/dydx', () => ({
  placeDydxConditionalOrder: dydxMock.place,
  cancelDydxConditionalOrder: dydxMock.cancel,
  getDydxOrders: dydxMock.orders,
  getDydxFills: dydxMock.fills,
  dydxSessionAddress: () => dydxMock.session.address
}));

import DydxTpSlCard from '../src/components/futures/DydxTpSlCard';
import FuturesHistory from '../src/components/futures/FuturesHistory';
import SpotDepth from '../src/components/spot/SpotDepth';

const position = { market: 'BTC-USD', side: 'LONG', size: 1, entryPrice: 100 };
const market = { ticker: 'BTC-USD', oraclePrice: 100, raw: { tickSize: '0.1' } };

beforeEach(() => {
  dydxMock.place.mockClear();
  dydxMock.cancel.mockClear();
  dydxMock.orders.mockClear();
  dydxMock.fills.mockClear();
  dydxMock.session.address = VALID_ADDR;
});
afterEach(() => cleanup());

const field = (container, id) => container.querySelector(`#${id}`);

describe('DydxTpSlCard — signing only from the confirm click', () => {
  it('renders and reads open orders, but signs nothing on its own', async () => {
    const { container } = render(
      <DydxTpSlCard position={position} market={market} address={VALID_ADDR} onChanged={() => {}} />
    );
    await waitFor(() => expect(dydxMock.orders).toHaveBeenCalled());
    expect(dydxMock.place).not.toHaveBeenCalled();
    expect(dydxMock.cancel).not.toHaveBeenCalled();
    expect(field(container, 'tp-BTC-USD')).toBeTruthy();
  });

  it('keeps the confirm button disabled until the plan is valid', () => {
    const { container } = render(
      <DydxTpSlCard position={position} market={market} address={VALID_ADDR} onChanged={() => {}} />
    );
    const submit = screen.getByTestId('dydx-tpsl-submit');
    expect(submit.disabled).toBe(true);
    fireEvent.change(field(container, 'tp-BTC-USD'), { target: { value: '110' } });
    expect(screen.getByTestId('dydx-tpsl-submit').disabled).toBe(false);
    expect(dydxMock.place).not.toHaveBeenCalled();
  });

  it('a take-profit on the wrong side of the market cannot be sent and says why', () => {
    const { container } = render(
      <DydxTpSlCard position={position} market={market} address={VALID_ADDR} onChanged={() => {}} />
    );
    fireEvent.change(field(container, 'tp-BTC-USD'), { target: { value: '99' } });
    expect(screen.getByTestId('dydx-tpsl-submit').disabled).toBe(true);
    expect(screen.getAllByText(/dydx\.tpsl\.err\.TRIGGER_PASSED/).length).toBeGreaterThan(0);
    expect(dydxMock.place).not.toHaveBeenCalled();
  });

  it('one click on confirm sends one reduce-only request per leg, and nothing else', async () => {
    const { container } = render(
      <DydxTpSlCard position={position} market={market} address={VALID_ADDR} onChanged={() => {}} />
    );
    fireEvent.change(field(container, 'tp-BTC-USD'), { target: { value: '110' } });
    fireEvent.change(field(container, 'sl-BTC-USD'), { target: { value: '95' } });
    fireEvent.click(screen.getByTestId('dydx-tpsl-submit'));
    await waitFor(() => expect(dydxMock.place).toHaveBeenCalledTimes(2));
    const legs = dydxMock.place.mock.calls.map((c) => c[0].leg);
    expect(legs.map((l) => l.kind).sort()).toEqual(['sl', 'tp']);
    for (const leg of legs) {
      expect(leg.reduceOnly).toBe(true);
      expect(leg.side).toBe('SELL');
    }
    expect(dydxMock.cancel).not.toHaveBeenCalled();
  });

  it('a cancel is a separate click on one named order', async () => {
    dydxMock.orders.mockResolvedValueOnce({
      orders: [{ clientId: 42, orderFlags: '32', ticker: 'BTC-USD', triggerPrice: '95', size: '1', goodTilBlockTime: new Date(Date.now() + 86400e3).toISOString() }],
      live: true
    });
    render(<DydxTpSlCard position={position} market={market} address={VALID_ADDR} onChanged={() => {}} />);
    const btn = await screen.findByTestId('dydx-tpsl-cancel-42');
    expect(dydxMock.cancel).not.toHaveBeenCalled();
    fireEvent.click(btn);
    await waitFor(() => expect(dydxMock.cancel).toHaveBeenCalledTimes(1));
    expect(dydxMock.cancel.mock.calls[0][0].clientId).toBe(42);
    expect(dydxMock.place).not.toHaveBeenCalled();
  });

  it('when the indexer cannot answer, it says so and does not show an old list as current', async () => {
    dydxMock.orders.mockResolvedValueOnce({ orders: [], live: false, reason: 'INDEXER_UNAVAILABLE' });
    render(<DydxTpSlCard position={position} market={market} address={VALID_ADDR} onChanged={() => {}} />);
    expect(await screen.findByText('dydx.tpsl.indexerUnavailable')).toBeTruthy();
  });
});

describe('FuturesHistory — read-only, honest about each venue', () => {
  const fill = {
    id: 'f1', createdAt: new Date(Date.now() - 3600e3).toISOString(), market: 'BTC-USD',
    side: 'SELL', size: '0.5', price: '60000', fee: '-1.2', orderId: 'o1'
  };

  it('shows the fill, a dash for PnL, and never NaN', async () => {
    dydxMock.fills.mockResolvedValueOnce({ fills: [fill], live: true });
    dydxMock.orders.mockResolvedValueOnce({ orders: [{ id: 'o1', reduceOnly: true, type: 'STOP_MARKET' }], live: true });
    const { container } = render(
      <MemoryRouter future={ROUTER_FUTURE}><FuturesHistory /></MemoryRouter>
    );
    await waitFor(() => expect(container.querySelector('.fhist-table tbody tr')).toBeTruthy());
    expect(container.textContent).not.toMatch(/NaN/);
    expect(container.textContent).toMatch(/BTC-USD/);
    expect(container.textContent).toMatch(/—/);
    expect(container.textContent).toMatch(/futures\.history\.dir\.long/);
  });

  it('has no send, cancel, edit or confirm control', async () => {
    dydxMock.fills.mockResolvedValueOnce({ fills: [fill], live: true });
    const { container } = render(<MemoryRouter future={ROUTER_FUTURE}><FuturesHistory /></MemoryRouter>);
    await waitFor(() => expect(container.querySelector('.fhist-table tbody tr')).toBeTruthy());
    const buttons = [...container.querySelectorAll('button, a')].map((b) => b.textContent.trim().toLowerCase());
    for (const label of buttons) {
      expect(label).not.toMatch(/cancel|send|edit|confirm|submit/);
    }
    expect(dydxMock.place).not.toHaveBeenCalled();
    expect(dydxMock.cancel).not.toHaveBeenCalled();
  });

  it('labels Ostium and Velocity as unavailable and links TP/SL to their existing screens', async () => {
    const { container } = render(<MemoryRouter future={ROUTER_FUTURE}><FuturesHistory /></MemoryRouter>);
    expect(await screen.findByText('futures.history.venue.ostiumUnavailable')).toBeTruthy();
    expect(screen.getByText('futures.history.venue.velocityUnavailable')).toBeTruthy();
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter((h) => h === '/ostium' || (h || '').startsWith('/perp'));
    expect(links).toEqual(['/ostium', '/perp?tab=onchain']);
  });

  it('says so when the dYdX indexer cannot answer', async () => {
    dydxMock.fills.mockResolvedValueOnce({ fills: [], live: false, reason: 'INDEXER_UNAVAILABLE' });
    render(<MemoryRouter future={ROUTER_FUTURE}><FuturesHistory /></MemoryRouter>);
    expect(await screen.findByText('futures.history.indexerUnavailable')).toBeTruthy();
  });
});

describe('SpotDepth — indicative quotes, labelled as such', () => {
  const fromToken = { symbol: 'ETH', address: '0x0000000000000000000000000000000000000001', decimals: 18 };
  const toToken = { symbol: 'USDC', address: '0x0000000000000000000000000000000000000002', decimals: 6 };

  it('states that the quotes are indicative and not an order book, and debounces the fetch', async () => {
    const fetchCurve = vi.fn(async () => ({
      curve: [
        { sizeUsd: 100, outAmount: 100, rate: 1, impactPct: 0, band: 'low', status: 'ok' },
        { sizeUsd: 500, outAmount: 490, rate: 0.98, impactPct: 2, band: 'high', status: 'ok' },
        { sizeUsd: 10000, outAmount: null, rate: null, impactPct: null, band: null, status: 'unavailable' }
      ],
      refreshedAt: Date.now(),
      fromCache: false
    }));
    const { container } = render(
      <SpotDepth chainId={1} fromToken={fromToken} toToken={toToken} fromUsdPrice={3000} fetchCurve={fetchCurve} />
    );
    // debounce: nothing is requested in the first moments
    expect(fetchCurve).not.toHaveBeenCalled();
    await waitFor(() => expect(fetchCurve).toHaveBeenCalledTimes(1), { timeout: 2000 });

    expect(container.textContent).toMatch(/spot\.depth\.caveat/);
    expect(container.textContent).toMatch(/spot\.depth\.disclaimer/);
    expect(container.textContent).not.toMatch(/NaN/);
    expect(container.textContent).toMatch(/spot\.depth\.band\.high/);
    expect(container.textContent).toMatch(/spot\.depth\.pointUnavailable/);
  });

  it('shows the no-price state and makes no quote request when there is no USD price', async () => {
    const fetchCurve = vi.fn(async () => ({ curve: [], refreshedAt: Date.now() }));
    render(<SpotDepth chainId={1} fromToken={fromToken} toToken={toToken} fromUsdPrice={null} fetchCurve={fetchCurve} />);
    expect(await screen.findByText('spot.depth.noPrice')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchCurve).not.toHaveBeenCalled();
  });

  it('never uses forbidden wording in the depth copy', () => {
    const banned = ['تضمین', 'بدون ریسک', 'سود قطعی', 'عمق واقعی', 'بهترین قیمت تضمین'];
    const copy = Object.values(EN.spot.depth).filter((v) => typeof v === 'string').join(' ');
    for (const w of banned) expect(copy.includes(w)).toBe(false);
  });
});
