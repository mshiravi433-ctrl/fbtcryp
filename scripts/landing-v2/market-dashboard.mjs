/**
 * Crawlable market dashboard used by the Persian and English market landing pages.
 *
 * The static HTML carries an honest explanation and a fixed list of examples;
 * current market rows, charts and trend readings are progressively enhanced
 * from the same public FBT API used by the app. Nothing is fabricated when a
 * feed is unavailable. The row-level "signal" is deliberately a transparent
 * 24-hour / 7-day direction comparison, not a buy/sell recommendation.
 */

const ASSETS = [
  { symbol: 'BTC', en: 'Bitcoin', fa: 'بیت‌کوین' },
  { symbol: 'ETH', en: 'Ethereum', fa: 'اتریوم' },
  { symbol: 'USDT', en: 'Tether', fa: 'تتر' },
  { symbol: 'USDC', en: 'USD Coin', fa: 'یو‌اس‌دی‌کوین' },
  { symbol: 'BNB', en: 'BNB', fa: 'بی‌ان‌بی' },
  { symbol: 'XRP', en: 'XRP', fa: 'ایکس‌آرپی' },
  { symbol: 'SOL', en: 'Solana', fa: 'سولانا' },
  { symbol: 'TRX', en: 'TRON', fa: 'ترون' },
  { symbol: 'DOGE', en: 'Dogecoin', fa: 'دوج‌کوین' },
  { symbol: 'ADA', en: 'Cardano', fa: 'کاردانو' },
  { symbol: 'BCH', en: 'Bitcoin Cash', fa: 'بیت‌کوین‌کش' },
  { symbol: 'LINK', en: 'Chainlink', fa: 'چین‌لینک' },
  { symbol: 'AVAX', en: 'Avalanche', fa: 'آوالانچ' },
  { symbol: 'SUI', en: 'Sui', fa: 'سویی' },
  { symbol: 'TON', en: 'Toncoin', fa: 'تون‌کوین' },
  { symbol: 'DOT', en: 'Polkadot', fa: 'پولکادات' },
  { symbol: 'XLM', en: 'Stellar', fa: 'استلار' },
  { symbol: 'LTC', en: 'Litecoin', fa: 'لایت‌کوین' },
  { symbol: 'UNI', en: 'Uniswap', fa: 'یونی‌سواپ' },
  { symbol: 'SHIB', en: 'Shiba Inu', fa: 'شیبا اینو' },
  { symbol: 'NEAR', en: 'NEAR Protocol', fa: 'نیر پروتکل' },
  { symbol: 'ICP', en: 'Internet Computer', fa: 'اینترنت کامپیوتر' },
  { symbol: 'APT', en: 'Aptos', fa: 'آپتوس' },
  { symbol: 'CRO', en: 'Cronos', fa: 'کرونوس' },
  { symbol: 'ETC', en: 'Ethereum Classic', fa: 'اتریوم کلاسیک' },
  { symbol: 'FIL', en: 'Filecoin', fa: 'فایل‌کوین' },
  { symbol: 'ARB', en: 'Arbitrum', fa: 'آربیتروم' },
  { symbol: 'OP', en: 'Optimism', fa: 'اپتیمیسم' },
  { symbol: 'HBAR', en: 'Hedera', fa: 'هدرا' },
  { symbol: 'KAS', en: 'Kaspa', fa: 'کاسپا' }
];

const COPY = {
  en: {
    kicker: 'CRYPTO MARKET DATA',
    title: 'Top 30 crypto assets: prices, charts and market signals',
    lede: 'The table loads up to 30 assets ordered by the market-data API. Each line chart uses the seven-day price series returned with that same response. The trend label compares the reported 24-hour and seven-day changes.',
    pulseTitle: 'Market pulse',
    pulseIntro: 'A market-wide reading from the public FBT signals endpoint. It can be unavailable when its source data is unavailable.',
    pulseLoading: 'Loading the market pulse…',
    pulseUnavailable: 'Market pulse unavailable. No placeholder reading is shown.',
    fieldUnavailable: 'Unavailable',
    pulseUpdated: 'Last update: ',
    sentiment: 'Market tone',
    momentum: 'Momentum',
    breadth: 'Market breadth',
    risk: 'Risk reading',
    loading: 'Loading market data…',
    tableTitle: 'Live market list · up to 30 assets',
    asset: 'Asset',
    price: 'USD reference price',
    change: '24 h change',
    chart: '7-day chart',
    signal: 'Trend reading',
    tableLoading: 'Waiting for the market-data API…',
    unavailable: 'Market data unavailable. Prices and charts are not being invented.',
    received: 'Loaded {n} assets from the market API. The order follows the API’s current market-cap ranking.',
    examplesTitle: '30 well-known crypto assets to explore',
    examplesNote: 'Examples only — this reference list is not a live ranking and does not imply that every asset is tradable on every network.',
    method: 'Trend method: positive on both windows means the two reported changes point upward; negative on both means they point downward; disagreement is shown as mixed. This summarizes past movement only. It is not a prediction, a personal signal or a buy/sell instruction.',
    up: 'Positive on both windows',
    down: 'Negative on both windows',
    mixed: 'Mixed readings',
    signalUnavailable: 'Insufficient data',
    pulseLabels: { bullish: 'Positive', bearish: 'Negative', neutral: 'Neutral' },
    momentumLabels: { up: 'Up', down: 'Down', flat: 'Flat', strong: 'Strong', moderate: 'Moderate' },
    riskLabels: { HIGH: 'High', MEDIUM: 'Moderate', LOW: 'Lower reading' },
    breadthValue: '{up} of {total} assets up',
    chartAlt: '{name} seven-day price chart',
    retry: 'Retry',
    fallback: 'Live rows need JavaScript and an available market feed; the examples above remain readable without either.'
  },
  fa: {
    kicker: 'دادهٔ بازار کریپتو',
    title: 'قیمت ۳۰ ارز دیجیتال؛ نمودار و خوانش داده‌محور بازار',
    lede: 'جدول پس از دریافت داده، حداکثر ۳۰ دارایی را بر اساس رتبهٔ روزِ API بازار مرتب می‌کند. نمودار خطی هر ردیف از سری قیمت هفت‌روزهٔ همان پاسخ ساخته می‌شود و خوانش روند، تغییر ۲۴ساعته را با تغییر هفت‌روزه مقایسه می‌کند.',
    pulseTitle: 'نبض بازار',
    pulseIntro: 'خلاصه‌ای از endpoint عمومی سیگنال اف‌بی‌تی؛ اگر دادهٔ منبع نرسد، این بخش هم عددی نمی‌سازد.',
    pulseLoading: 'در حال دریافت نبض بازار…',
    pulseUnavailable: 'نبض بازار در دسترس نیست؛ عدد جایگزین نمایش داده نمی‌شود.',
    fieldUnavailable: 'ناموجود',
    pulseUpdated: 'آخرین به‌روزرسانی: ',
    sentiment: 'حال‌وهوای بازار',
    momentum: 'جهت مومنتوم',
    breadth: 'گستردگی بازار',
    risk: 'خوانش ریسک',
    loading: 'در حال دریافت دادهٔ بازار…',
    tableTitle: 'فهرست زندهٔ بازار؛ حداکثر ۳۰ دارایی',
    asset: 'دارایی',
    price: 'قیمت مرجع به دلار',
    change: 'تغییر ۲۴ساعته',
    chart: 'نمودار ۷روزه',
    signal: 'خوانش روند',
    tableLoading: 'در انتظار پاسخ API بازار…',
    unavailable: 'دادهٔ بازار در دسترس نیست؛ قیمت و نمودار ساختگی نمایش داده نمی‌شود.',
    received: 'دادهٔ {n} دارایی از API بازار دریافت شد. ترتیب، رتبهٔ ارزش بازار در پاسخ فعلی API است.',
    examplesTitle: '۳۰ دارایی شناخته‌شده برای آشنایی و پیگیری',
    examplesNote: 'این‌ها نمونه‌اند، نه رتبه‌بندی زنده؛ همچنین به‌معنای امکان معاملهٔ هر دارایی روی هر شبکه نیستند.',
    method: 'روش خوانش روند: اگر تغییر ۲۴ساعته و هفت‌روزه هر دو مثبت باشند، هر دو پنجره رو به بالا هستند؛ اگر هر دو منفی باشند، رو به پایین؛ و اگر هم‌جهت نباشند، «ترکیبی» نشان داده می‌شود. این فقط خلاصهٔ حرکت گذشته است؛ پیش‌بینی، توصیهٔ شخصی یا دستور خریدوفروش نیست.',
    up: 'هر دو بازه مثبت',
    down: 'هر دو بازه منفی',
    mixed: 'خوانش ترکیبی',
    signalUnavailable: 'داده کافی نیست',
    pulseLabels: { bullish: 'مثبت', bearish: 'منفی', neutral: 'خنثی' },
    momentumLabels: { up: 'صعودی', down: 'نزولی', flat: 'کم‌جهت', strong: 'قوی', moderate: 'میانه' },
    riskLabels: { HIGH: 'بالا', MEDIUM: 'میانه', LOW: 'خوانش پایین‌تر' },
    breadthValue: '{up} از {total} دارایی مثبت',
    chartAlt: 'نمودار قیمت هفت‌روزهٔ {name}',
    retry: 'تلاش دوباره',
    fallback: 'ردیف‌های زنده به JavaScript و دسترسی به فید بازار نیاز دارند؛ فهرست نمونه‌های بالا بدون آن‌ها هم خواناست.'
  }
};

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMarketDashboard(lang = 'en') {
  const isFa = lang === 'fa';
  const copy = COPY[isFa ? 'fa' : 'en'];
  const examples = ASSETS.map((asset) => {
    const name = isFa ? asset.fa : asset.en;
    return `<li><span lang="en" dir="ltr">${esc(asset.symbol)}</span> — ${esc(name)}</li>`;
  }).join('\n          ');

  return `<section class="market-board panel reveal" id="live-market-data" aria-labelledby="market-board-title">
    <div class="market-board-heading">
      <p class="section-kicker">${esc(copy.kicker)}</p>
      <h2 id="market-board-title">${esc(copy.title)}</h2>
      <p>${esc(copy.lede)}</p>
    </div>
    <section class="market-pulse" aria-labelledby="market-pulse-title">
      <div>
        <h3 id="market-pulse-title">${esc(copy.pulseTitle)}</h3>
        <p>${esc(copy.pulseIntro)}</p>
      </div>
      <dl class="market-pulse-grid">
        <div><dt>${esc(copy.sentiment)}</dt><dd id="market-pulse-sentiment">—</dd></div>
        <div><dt>${esc(copy.momentum)}</dt><dd id="market-pulse-momentum">—</dd></div>
        <div><dt>${esc(copy.breadth)}</dt><dd id="market-pulse-breadth">—</dd></div>
        <div><dt>${esc(copy.risk)}</dt><dd id="market-pulse-risk">—</dd></div>
      </dl>
      <p class="market-status" id="market-pulse-status" role="status" aria-live="polite">${esc(copy.pulseLoading)}</p>
    </section>
    <div class="market-table-shell">
      <div class="market-table-title-row">
        <h3>${esc(copy.tableTitle)}</h3>
        <span class="market-count" id="market-data-count">—</span>
      </div>
      <div class="table-scroll">
        <table class="market-live-table">
          <caption>${esc(copy.tableTitle)}</caption>
          <thead><tr>
            <th scope="col">${esc(copy.asset)}</th>
            <th scope="col">${esc(copy.price)}</th>
            <th scope="col">${esc(copy.change)}</th>
            <th scope="col">${esc(copy.chart)}</th>
            <th scope="col">${esc(copy.signal)}</th>
          </tr></thead>
          <tbody id="market-assets-body"><tr><td colspan="5">${esc(copy.tableLoading)}</td></tr></tbody>
        </table>
      </div>
      <p class="market-status" id="market-data-status" role="status" aria-live="polite">${esc(copy.loading)}</p>
      <p class="market-method">${esc(copy.method)}</p>
    </div>
    <details class="market-examples">
      <summary>${esc(copy.examplesTitle)}</summary>
      <p>${esc(copy.examplesNote)}</p>
      <ol>${examples}</ol>
    </details>
  </section>`;
}

export const MARKET_DASHBOARD_STYLES = `
  .market-board { padding: clamp(20px, 4vw, 38px); }
  .market-board-heading { max-width: 850px; }
  .market-board-heading h2 { margin: 0 0 10px; color: #eff3ff; font-size: clamp(24px, 4vw, 38px); line-height: 1.3; }
  .market-board-heading > p:last-child, .market-pulse > div > p { color: var(--muted); font-size: 14px; line-height: 1.85; }
  .market-pulse { margin-top: 22px; padding: 20px; border: 1px solid var(--line); border-radius: 18px; background: rgba(4, 7, 17, .55); }
  .market-pulse h3, .market-table-title-row h3 { margin: 0 0 8px; color: var(--ink); font-size: 17px; }
  .market-pulse-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 16px 0 0; }
  .market-pulse-grid > div { min-width: 0; padding: 12px; border: 1px solid rgba(163, 181, 227, .12); border-radius: 12px; }
  .market-pulse-grid dt { color: var(--quiet); font-size: 11px; }
  .market-pulse-grid dd { margin: 5px 0 0; color: var(--ink); font-size: 13px; font-weight: 750; }
  .market-table-shell { margin-top: 18px; overflow: hidden; border: 1px solid var(--line); border-radius: 18px; background: rgba(4, 7, 17, .55); }
  .market-table-title-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; align-items: center; padding: 17px 18px 10px; }
  .market-table-title-row h3 { margin: 0; }
  .market-count { color: var(--quiet); font-size: 12px; }
  .table-scroll { max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
  .market-live-table { width: 100%; border-collapse: collapse; min-width: 740px; font-size: 12px; }
  .market-live-table caption { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .market-live-table th, .market-live-table td { padding: 11px 12px; border-top: 1px solid rgba(163, 181, 227, .11); text-align: start; white-space: nowrap; }
  .market-live-table th { color: var(--quiet); font-size: 11px; font-weight: 700; }
  .market-live-table td { color: var(--muted); }
  .market-asset-link { color: var(--ink); font-weight: 750; text-decoration: none; }
  .market-asset-link:hover { color: var(--cyan); text-decoration: underline; }
  .market-symbol { display: inline-block; min-width: 50px; margin-inline-end: 8px; color: var(--cyan); font-family: ui-monospace, monospace; }
  .market-price, .market-change { font-variant-numeric: tabular-nums; }
  .market-change.up { color: var(--lime); }
  .market-change.down { color: #ff8496; }
  .market-change.flat { color: var(--muted); }
  .market-spark svg { display: block; width: 112px; height: 32px; overflow: visible; }
  .market-trend { display: inline-flex; max-width: 175px; padding: 5px 8px; border-radius: 999px; font-size: 11px; }
  .market-trend.up { color: #b2ffe2; background: rgba(99, 245, 187, .11); }
  .market-trend.down { color: #ffc3cc; background: rgba(255, 91, 118, .12); }
  .market-trend.mixed, .market-trend.unavailable { color: #d7dbeb; background: rgba(163, 181, 227, .11); }
  .market-status { min-height: 1.5em; margin: 10px 16px 0; color: var(--quiet); font-size: 12px; }
  .market-retry { margin-inline-start: 8px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); background: rgba(255, 255, 255, .07); font: inherit; cursor: pointer; }
  .market-retry:hover { border-color: var(--cyan); }
  .market-method { margin: 12px 16px 17px; color: var(--muted); font-size: 12px; line-height: 1.8; }
  .market-examples { margin-top: 18px; padding: 18px 20px; border: 1px solid var(--line); border-radius: 18px; background: rgba(4, 7, 17, .44); }
  .market-examples summary { color: var(--ink); font-weight: 750; cursor: pointer; }
  .market-examples p { margin: 10px 0; color: var(--muted); font-size: 12px; line-height: 1.8; }
  .market-examples ol { columns: 3; column-gap: 30px; margin: 14px 0 0; padding-inline-start: 22px; color: var(--muted); font-size: 12px; }
  .market-examples li { break-inside: avoid; padding: 3px 0; }
  @media (max-width: 680px) {
    .market-pulse-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .market-examples ol { columns: 2; }
  }
  @media (prefers-reduced-motion: reduce) {
    .market-board *, .market-board *::before, .market-board *::after { scroll-behavior: auto !important; }
  }
`;

export function marketDashboardScript(lang = 'en') {
  const copy = COPY[lang === 'fa' ? 'fa' : 'en'];
  const locale = lang === 'fa' ? 'fa-IR' : 'en-US';
  const serializedCopy = JSON.stringify(copy).replace(/</g, '\\u003c');
  return `(() => {
  'use strict';
  const COPY = ${serializedCopy};
  const LOCALE = ${JSON.stringify(locale)};
  const body = document.getElementById('market-assets-body');
  const dataStatus = document.getElementById('market-data-status');
  const count = document.getElementById('market-data-count');
  if (!body || !dataStatus) return;

  const number = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  };
  const localNumber = (value) => new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(value);
  const formatPrice = (value) => {
    const n = number(value);
    if (n === null || n <= 0) return '—';
    const digits = n >= 1000 ? 2 : n >= 1 ? 2 : n >= 0.01 ? 4 : 6;
    return '$' + new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }).format(n);
  };
  const formatPercent = (value) => {
    const n = number(value);
    if (n === null) return '—';
    const formatted = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format(n);
    return formatted + (${JSON.stringify(lang === 'fa' ? '٪' : '%')});
  };
  const setText = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };
  const trendFor = (coin) => {
    const day = number(coin.change24h);
    const week = number(coin.change7d);
    if (day === null || week === null) return { label: COPY.signalUnavailable, tone: 'unavailable' };
    if (day > 0 && week > 0) return { label: COPY.up, tone: 'up' };
    if (day < 0 && week < 0) return { label: COPY.down, tone: 'down' };
    return { label: COPY.mixed, tone: 'mixed' };
  };
  const drawSparkline = (values, name) => {
    const series = Array.isArray(values) ? values.map(number).filter((n) => n !== null && n > 0) : [];
    if (series.length < 2) return null;
    const low = Math.min(...series);
    const high = Math.max(...series);
    const span = high - low || Math.max(high * 0.000001, 1);
    const width = 112;
    const height = 30;
    const inset = 2;
    const d = series.map((value, i) => {
      const x = inset + (i / (series.length - 1)) * (width - inset * 2);
      const y = height - inset - ((value - low) / span) * (height - inset * 2);
      return (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
    }).join(' ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', COPY.chartAlt.replace('{name}', name));
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', series[series.length - 1] >= series[0] ? '#63f5bb' : '#ff8496');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  };
  const renderMarkets = (rows) => {
    body.replaceChildren();
    const fragment = document.createDocumentFragment();
    rows.slice(0, 30).forEach((coin) => {
      const row = document.createElement('tr');
      const assetCell = document.createElement('th');
      assetCell.scope = 'row';
      const link = document.createElement('a');
      link.className = 'market-asset-link';
      link.href = '/#/coin/' + encodeURIComponent(String(coin.id || ''));
      const symbol = document.createElement('span');
      symbol.className = 'market-symbol';
      symbol.dir = 'ltr';
      symbol.textContent = String(coin.symbol || '').toUpperCase();
      link.append(symbol, document.createTextNode(String(coin.name || coin.symbol || '—')));
      assetCell.appendChild(link);

      const priceCell = document.createElement('td');
      priceCell.className = 'market-price';
      priceCell.textContent = formatPrice(coin.price);

      const changeCell = document.createElement('td');
      changeCell.className = 'market-change';
      const change = number(coin.change24h);
      changeCell.textContent = formatPercent(change);
      changeCell.classList.add(change === null || change === 0 ? 'flat' : change > 0 ? 'up' : 'down');

      const chartCell = document.createElement('td');
      chartCell.className = 'market-spark';
      const spark = drawSparkline(coin.sparkline, String(coin.name || coin.symbol || 'asset'));
      if (spark) chartCell.appendChild(spark);
      else chartCell.textContent = '—';

      const trendCell = document.createElement('td');
      const trend = trendFor(coin);
      const badge = document.createElement('span');
      badge.className = 'market-trend ' + trend.tone;
      badge.textContent = trend.label;
      trendCell.appendChild(badge);

      row.append(assetCell, priceCell, changeCell, chartCell, trendCell);
      fragment.appendChild(row);
    });
    body.appendChild(fragment);
    if (count) count.textContent = localNumber(Math.min(rows.length, 30)) + ' / ' + localNumber(30);
  };
  const fetchJson = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  };
  const loadMarkets = async () => {
    try {
      const rows = await fetchJson('/api/markets?page=1&per_page=30&vs=usd');
      if (!Array.isArray(rows) || !rows.length) throw new Error('Empty market response');
      renderMarkets(rows);
      dataStatus.textContent = COPY.received.replace('{n}', localNumber(Math.min(rows.length, 30)));
    } catch {
      body.replaceChildren();
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = COPY.unavailable;
      row.appendChild(cell);
      body.appendChild(row);
      dataStatus.textContent = COPY.fallback;
      if (count) count.textContent = '—';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'market-retry';
      retry.textContent = COPY.retry;
      retry.addEventListener('click', loadMarkets, { once: true });
      dataStatus.appendChild(document.createTextNode(' '));
      dataStatus.appendChild(retry);
    }
  };
  const loadPulse = async () => {
    const status = document.getElementById('market-pulse-status');
    try {
      const pulse = await fetchJson('/api/signals/pulse');
      if (!pulse || pulse.source === 'unavailable') throw new Error('Unavailable pulse');
      const sentiment = pulse.sentiment && pulse.sentiment.label;
      const momentum = pulse.momentum && (pulse.momentum.direction || pulse.momentum.label);
      const breadth = pulse.breadth;
      const risk = pulse.risk && pulse.risk.label;
      setText('market-pulse-sentiment', COPY.pulseLabels[sentiment] || COPY.fieldUnavailable);
      setText('market-pulse-momentum', COPY.momentumLabels[momentum] || COPY.fieldUnavailable);
      const breadthUp = breadth ? number(breadth.up) : null;
      const breadthTotal = breadth ? number(breadth.total) : null;
      setText('market-pulse-breadth', breadthUp !== null && breadthTotal !== null && breadthTotal > 0
        ? COPY.breadthValue.replace('{up}', localNumber(breadthUp)).replace('{total}', localNumber(breadthTotal)) : COPY.fieldUnavailable);
      setText('market-pulse-risk', COPY.riskLabels[risk] || COPY.fieldUnavailable);
      const pulseTime = number(pulse.at);
      if (status) status.textContent = pulseTime !== null ? COPY.pulseUpdated + new Date(pulseTime).toLocaleString(LOCALE) : '';
    } catch {
      ['market-pulse-sentiment', 'market-pulse-momentum', 'market-pulse-breadth', 'market-pulse-risk']
        .forEach((id) => setText(id, '—'));
      if (status) status.textContent = COPY.pulseUnavailable;
    }
  };

  loadMarkets();
  loadPulse();
})();`;
}
