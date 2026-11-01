/**
 * MATERIAL PREVIEW — the token page's candlestick terminal.
 * ---------------------------------------------------------------------------
 * Opens the REAL component (src/components/ProChart/TokenChart.jsx) with the
 * REAL stylesheet (src/styles/pro-chart.css) against deterministic synthetic
 * candles, so the card, the small expand button and the full-screen analysis
 * desk can be reviewed without a market feed, a wallet or an account.
 *
 * No network is touched: the candles below are generated from a seeded PRNG,
 * so the same picture appears every time and a visual diff means something.
 *
 * Start the dev server and open:
 *   /test/fixtures/pro-chart.html?lang=fa&theme=dark
 *   /test/fixtures/pro-chart.html?lang=en&theme=light&symbol=pepe
 */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import i18n from '../../src/i18n/index.js';
import fa from '../../src/i18n/locales/fa.json';
import en from '../../src/i18n/locales/en.json';
import TokenChart from '../../src/components/ProChart/TokenChart.jsx';
import '../../src/index.css';

const params = new URLSearchParams(location.search);
i18n.addResourceBundle('fa', 'translation', fa);
i18n.addResourceBundle('en', 'translation', en);
await i18n.changeLanguage(params.get('lang') === 'en' ? 'en' : 'fa');
document.documentElement.lang = i18n.language;
document.documentElement.dir = i18n.language === 'fa' ? 'rtl' : 'ltr';
document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark';

const DAY = 86_400_000;

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const SYMBOLS = {
  eth: {
    id: 'ethereum', symbol: 'ETH', name: 'Ethereum',
    price: 3412.55, change1h: 0.35, change24h: 2.14, change7d: -3.42,
    volume: 18_400_000_000, mcap: 412_000_000_000, supply: 120_400_000,
    high24h: 3510, low24h: 3295, athChange: -18.4, rank: 2
  },
  pepe: {
    id: 'pepe', symbol: 'PEPE', name: 'Pepe',
    price: 0.0000084, change1h: -0.2, change24h: 6.8, change7d: 14.2,
    volume: 1_240_000_000, mcap: 3_500_000_000, supply: 420_000_000_000_000,
    high24h: 0.0000088, low24h: 0.0000077, athChange: -63.2, rank: 28
  }
};

const RANGES = [
  { key: '1D', days: 1 },
  { key: '7D', days: 7 },
  { key: '30D', days: 30 },
  { key: '90D', days: 90 },
  { key: '1Y', days: 365 }
];

function makeCandles(days, basePrice) {
  const rand = seeded(11 + days);
  const spacing = days <= 2 ? 30 * 60_000 : days <= 30 ? 4 * 3600_000 : 4 * DAY;
  const count = days <= 2 ? 48 : days <= 7 ? 42 : days <= 30 ? 180 : 90;
  const now = Date.UTC(2026, 10, 1, 12, 0, 0);
  const out = [];
  let price = basePrice * 0.85;
  for (let i = count; i > 0; i--) {
    const drift = Math.sin(i / 7) * 0.008 + (rand() - 0.48) * 0.014;
    const o = price;
    const c = Math.max(basePrice / 1000, o * (1 + drift));
    const h = Math.max(o, c) * (1 + rand() * 0.006);
    const l = Math.min(o, c) * (1 - rand() * 0.006);
    out.push({ t: now - i * spacing, o, h, l, c });
    price = c;
  }
  return out;
}

function makeVolume(days) {
  const rand = seeded(29 + days);
  const now = Date.UTC(2026, 10, 1, 12, 0, 0);
  const spacing = days <= 2 ? 5 * 60_000 : 3600_000;
  const count = days <= 2 ? 288 : 24 * 20;
  return Array.from({ length: count }, (_, i) => ({
    t: now - (count - i) * spacing,
    v: 9_000_000_000 + rand() * 6_000_000_000
  }));
}

function Demo() {
  const [symbolKey, setSymbolKey] = useState(params.get('symbol') === 'pepe' ? 'pepe' : 'eth');
  const [range, setRange] = useState(RANGES[2]);
  const coin = SYMBOLS[symbolKey];
  const [candles, setCandles] = useState(() => makeCandles(range.days, coin.price));

  const info = document.getElementById('pv-info');
  if (info) info.textContent = `${coin.symbol} · ${range.key} · ${candles.length} candles`;

  /* The preview's own bar drives state through the same props the page does. */
  window.__pv = {
    setSymbol: (key) => {
      setSymbolKey(key);
      setCandles(makeCandles(range.days, SYMBOLS[key].price));
    },
    theme: (value) => { document.documentElement.dataset.theme = value; },
    lang: (value) => {
      i18n.changeLanguage(value);
      document.documentElement.lang = value;
      document.documentElement.dir = value === 'fa' ? 'rtl' : 'ltr';
    }
  };

  return (
    <div className="page">
      <div className="card card-rgb pv-card">
        <TokenChart
          data={candles}
          symbol={coin.symbol}
          coin={coin}
          coinId={coin.id}
          range={range}
          ranges={RANGES}
          onRangeChange={(next) => {
            setRange(next);
            setCandles(makeCandles(next.days, coin.price));
          }}
          height={300}
        />
      </div>
    </div>
  );
}

let themeLight = document.documentElement.dataset.theme === 'light';
document.getElementById('pv-theme')?.addEventListener('click', (event) => {
  themeLight = !themeLight;
  document.documentElement.dataset.theme = themeLight ? 'light' : 'dark';
  event.currentTarget.setAttribute('aria-pressed', String(themeLight));
});
let langFa = i18n.language !== 'en';
document.getElementById('pv-lang')?.addEventListener('click', () => {
  langFa = !langFa;
  window.__pv.lang(langFa ? 'fa' : 'en');
});
document.getElementById('pv-symbol')?.addEventListener('click', (event) => {
  const next = event.currentTarget.getAttribute('data-sym') === 'pepe' ? 'eth' : 'pepe';
  event.currentTarget.setAttribute('data-sym', next);
  window.__pv.setSymbol(next);
});

createRoot(document.getElementById('root')).render(<Demo />);
