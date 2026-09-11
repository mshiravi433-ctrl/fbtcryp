/**
 * CROSS TAB — «تحلیل کراس» rendered in Persian, not just imported.
 * ---------------------------------------------------------------------------
 * The report this pins:
 *   · «باکسش خیلی شلوغه … باید معیارها با آیکون بالا و پایین و فارسی باشد»
 *     — the economic-outlook criteria were English sentences in a Persian box.
 *   · «باکس رمز ارز و نمودار پایینی داخل یک باکس باشد و مدرن‌تر و قشنگ‌تر»
 *     — the class tiles and the class chart were two boxes repeating the same
 *     numbers.
 *   · «کارت‌های برتر اقتصاد جهانی داده‌ها موجود نیست» — the four leader cards
 *     were built from one venue and rendered four identical empties.
 *   · «این باکس را حذف کن و دوتا داده را داخل تحلیل سیستمی باشد و تکراری
 *     نباشد» — two stacked analysis boxes said the same thing twice.
 *   · «ایموجی‌های داخل باکس‌ها مدرن‌تر شود» + «رشد خنثی با رنگ طوسی».
 *
 * The fixture is NOT hand-written JSON: it is produced by the REAL
 * analyzeCrossAsset() engine over a realistic pass, so the probe fails if the
 * server stops shipping what the screen draws (narrativeLines, nameFa,
 * evidenceFa, macro.indicators).
 *
 * Build: vite build -c test/vite.crosstab.mjs
 * Run:   node test/run-one-probe.mjs ./.out/crosstab/cross-tab-probe.js
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../src/i18n/index.js';
import faLocale from '../../src/i18n/locales/fa.json';
import AiGlobalIntelligence from '../../src/components/ai/AiGlobalIntelligence.jsx';
import { analyzeCrossAsset } from '../../server/fios/crossAsset.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A pass where every source answered: crypto from the world model, the four
   global classes from the snapshot, the macro desk with real quotes + curve. */
const CROSS_ASSET = analyzeCrossAsset({
  now: Date.now(),
  world: {
    domains: {
      market: {
        schema: 'fbt.fi.provenance.v1',
        value: { changes24hPct: { BTC: -1.2, ETH: 2.5, SOL: 0.4 } }
      }
    }
  },
  globalIntel: {
    schema: 'fbt.fi.global-intelligence.v1',
    at: Date.now(),
    domains: {
      stocks: { status: 'OK', reason: null, source: 'brain:stocks', at: Date.now(), confidence: 0.7, data: { instruments: [
        { symbol: 'NVDA', name: 'NVIDIA', kind: 'equity', priceUsd: 120, change24hPct: 3.1 },
        { symbol: 'TSLA', name: 'Tesla', kind: 'equity', priceUsd: 250, change24hPct: -0.8 }
      ] } },
      forex: { status: 'OK', reason: null, source: 'brain:forex', at: Date.now(), confidence: 0.7, data: { instruments: [
        { symbol: 'EUR/USD', kind: 'currency', priceUsd: 1.085, change24hPct: 0.15 }
      ] } },
      commodities: { status: 'OK', reason: null, source: 'brain:commodities', at: Date.now(), confidence: 0.7, data: { instruments: [
        { symbol: 'XAU/USD', kind: 'metal', priceUsd: 2400, change24hPct: 0.6 }
      ] } },
      rwa: { status: 'UNAVAILABLE', reason: 'PROVIDER_TIMEOUT', source: 'brain:rwa', at: Date.now(), confidence: 0, data: null },
      macro: { status: 'OK', reason: null, source: 'macro:classifier', at: Date.now(), confidence: 0.7, data: {
        items: [{ topic: 'FED', title: 'Fed signals patience on cuts', at: Date.now() }],
        byTopic: { FED: 1 },
        attention: 1,
        instruments: [
          { symbol: 'DXY', name: 'US Dollar Index', kind: 'currency', priceUsd: 108.2, change1dPct: 0.8, change7dPct: 1.2, source: 'stooq:DX.F' },
          { symbol: 'GOLD', name: 'Gold (USD/oz)', kind: 'safe_haven', priceUsd: 2450.5, change1dPct: 0.5, change7dPct: 2.1, source: 'stooq:GC.F' },
          { symbol: 'SPX', name: 'S&P 500 futures', kind: 'equity', priceUsd: 5842.5, change1dPct: 0.6, change7dPct: 1.7, source: 'stooq:ES.F' },
          { symbol: 'US10Y', name: 'US 10Y yield (%)', kind: 'rate', priceUsd: 4.21, change1dPct: 0.4, change7dPct: 1.1, source: 'fred:T10YIE' }
        ],
        curve: { symbol: 'US2S10S', spreadPct: -0.21, change7dPct: -0.3, source: 'fred:T10Y2Y' },
        untrusted: true
      } }
    }
  }
});

const INTEL = {
  ok: true,
  schema: 'fbt.fi.global-intelligence.v1',
  globalIntelligence: {
    schema: 'fbt.fi.global-intelligence.v1', owner: 'dev:cross', at: Date.now(),
    domains: {
      smart_money: { status: 'OK', reason: null, source: 'smartMoney:overview', at: Date.now(), confidence: 0.8, data: {
        topTokens: [
          { symbol: 'ETH', name: 'Ethereum', chain: 'ethereum', signal: 'accumulation', exchangeOutflowUsd: 4200000 },
          { symbol: 'SOL', name: 'Solana', chain: 'solana', signal: 'accumulation', exchangeOutflowUsd: 900000 }
        ]
      } },
      macro: { status: 'OK', reason: null, source: 'macro:classifier', at: Date.now(), confidence: 0.7, data: { attention: 1, byTopic: { FED: 1 }, items: [], instruments: [] } }
    }
  }
};
const BRIEFING = { ok: true, briefing: { schema: 'fbt.fi.briefing.v1', at: Date.now(), items: [], missing: [] } };
const PROVIDERS = { ok: true, providers: { schema: 'fbt.fi.providers.v1', at: Date.now(), rows: [] } };

export async function run(container) {
  const rows = [];
  const check = (name, ok, extra) => { rows.push([name, !!ok]); console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${JSON.stringify(extra ?? null)}`}`); };
  const q = (sel) => container.querySelector(sel);
  const all = (sel) => Array.from(container.querySelectorAll(sel));
  const text = () => container.textContent || '';

  const errors = [];
  const realError = console.error;
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (s.includes('useLayoutEffect') || s.includes('act(') || s.includes('not wrapped')) return;
    if (s.includes('Not implemented') || s.includes('React Router Future Flag')) return;
    if (/ReactDOMTestUtils|deprecated/i.test(s)) return;
    errors.push(s);
  };

  const realFetch = global.fetch;
  global.fetch = async (url) => ({
    ok: true,
    json: async () => {
      if (String(url).includes('/global/briefing')) return BRIEFING;
      if (String(url).includes('/global/cross-asset')) return { ok: true, crossAsset: CROSS_ASSET };
      if (String(url).includes('/global/providers')) return PROVIDERS;
      return INTEL;
    }
  });

  /* The report is about the PERSIAN screen. The app lazy-loads every locale
     but English through import.meta.glob, which a probe bundle cannot fetch —
     so the fa dictionary is registered the same way loadLocale() registers it
     after a successful fetch, and the switch is then the app's own. */
  i18n.addResourceBundle('fa', 'translation', faLocale, true, true);
  await act(async () => { await i18n.changeLanguage('fa'); });
  if (String(i18n.resolvedLanguage) !== 'fa') throw new Error(`probe could not switch to fa (resolved=${i18n.resolvedLanguage})`);

  const root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter><AiGlobalIntelligence /></MemoryRouter>);
  });
  await act(async () => { await sleep(30); });

  const crossTab = all('button').find((b) => (b.textContent || '').includes('🔀'));
  await act(async () => { crossTab?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { await sleep(10); });

  const section = q('.aig-section');
  const sectionText = section ? section.textContent : '';
  const has = (needle) => sectionText.includes(needle);

  /* ── 0. the fixture really is the engine's output ─────────────────────── */
  check('engine: the fixture carries narrativeLines + Persian signal names (server contract)',
    Array.isArray(CROSS_ASSET.narrativeLines?.fa) && CROSS_ASSET.narrativeLines.fa.length >= 5
    && CROSS_ASSET.outlook.signals.every((s) => s.nameFa && s.evidenceFa)
    && CROSS_ASSET.macro.status === 'OK' && CROSS_ASSET.macro.indicators.length === 4,
    { lines: CROSS_ASSET.narrativeLines?.fa?.length, macro: CROSS_ASSET.macro?.status });

  /* ── 1. one card holds the chart AND the per-class readings ───────────── */
  const move = q('.aig-move');
  check('cross: the class chart and the per-class readings live in ONE card (not two boxes)',
    !!move && !!move.querySelector('.aig-chart-svg') && move.querySelectorAll('.aig-move-row').length >= 4
    && all('.aig-move').length === 1,
    { moves: all('.aig-move').length, rows: move?.querySelectorAll('.aig-move-row').length });
  check('cross: each class row carries its own direction marker and a real average',
    all('.aig-move-row').every((r) => r.querySelector('.aig-dir') && /٪|%/.test(r.textContent || ''))
    && all('.aig-move-avg').length >= 4);

  /* ── 2. the outlook criteria are Persian, each with an up/down marker ─── */
  check('cross: the outlook criteria are Persian — no raw English evidence left in the box',
    has('چشم‌انداز اقتصادی') && has('منحنی بازده') && has('وارونه')
    && !/supportive|restrictive|classified macro headlines|FIGR_|INVERTED/.test(sectionText));
  check('cross: every outlook signal has a direction marker next to its Persian label',
    all('.aig-signal').length >= 2
    && all('.aig-signal-dir').every((el) => !!el.querySelector('.aig-dir'))
    && all('.aig-signal-dir').some((el) => /هشداردهنده|پشتیبان|خنثی/.test(el.textContent || '')));
  check('cross: a neutral criterion is grey, not silently unmarked',
    all('.aig-signal-dir.neutral .aig-dir-flat').length >= 1 || all('.aig-dir-flat').length >= 1,
    { flat: all('.aig-dir-flat').length });

  /* ── 3. ONE system-analysis box — the duplicate is gone ───────────────── */
  check('cross: exactly ONE analysis box — the duplicate narrative box was removed',
    all('.aig-narrative').length === 1 && has('تحلیل سیستمی')
    && !/تحلیل پیشرفته با هوش مصنوعی/.test(sectionText),
    { boxes: all('.aig-narrative').length });
  const lines = all('.aig-analysis-line');
  check('cross: the system analysis renders one line per measured fact, each with a marker',
    lines.length >= 5 && lines.every((li) => !!li.querySelector('.aig-dir') && (li.textContent || '').trim().length > 4),
    { lines: lines.length });
  check('cross: the analysis lines are Persian and quote the real per-class averages',
    has('رمزارز') && has('سهام') && /٪/.test(sectionText)
    && !/FIGR_|macro headlines|supportive/.test(sectionText));
  check('cross: an unread class is named as unread — never given a number',
    has('خوانده نشد') && has('دارایی واقعی') && !/دارایی واقعی[^—]{0,40}[+\-−]?\d/.test(sectionText.replace(/خوانده نشد[^.]*دارایی واقعی/, '')) );
  check('cross: a neutral line is grey (is-flat), not coloured up/down',
    all('.aig-analysis-line.is-flat').length >= 1 && all('.aig-analysis-line.is-flat .aig-dir-flat').length >= 1);

  /* ── 4. the leader cards show what was actually read ──────────────────── */
  const cards = all('.aig-insight-card');
  check('cross: the global-economy leader cards carry real macro reads (dollar / equity index / curve)',
    cards.length >= 4 && has('بیشترین رشد ۲۴ ساعته') && has('شاخص سهام') && has('منحنی بازده آمریکا')
    && /DXY|GOLD|SPX|US10Y/.test(sectionText) && /2s10s/.test(sectionText)
    && has('وارون'),
    { cards: cards.length });
  check('cross: a leader card whose input was not read says so instead of inventing a value',
    all('.aig-insight-empty').every((el) => /خوانده نشد/.test(el.textContent || ''))
    && all('.aig-insight-card').some((c) => c.querySelector('.aig-insight-value')));
  check('cross: the observed smart-money outflow is still a leader card (real labelled flow)',
    has('بیشترین خروج پول') && /ETH|SOL/.test(sectionText));

  /* ── 5. no emoji left inside the boxes ────────────────────────────────── */
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;
  check('cross: no emoji glyph remains inside the section — icons are inline SVG',
    !emoji.test(sectionText) && all('.aig-section svg').length >= 8,
    { svgs: all('.aig-section svg').length });

  /* ── 6. honesty rails ─────────────────────────────────────────────────── */
  check('cross: the numbers inside the Persian boxes use Persian digits (no Latin % fragments)',
    !/[+\-]?\d+(\.\d+)?%/.test(sectionText) && /٪/.test(sectionText) && !/\b1d\b|\b7d\b/.test(sectionText),
    { latin: (sectionText.match(/[+\-]?\d+(\.\d+)?%/g) || []).slice(0, 4) });
  check('cross: the macro desk quotes are named in Persian, ticker kept as the source symbol',
    has('شاخص دلار') && has('بازده ۱۰ سالهٔ آمریکا') && /DXY/.test(sectionText) && has('۲۴س'));
  check('cross: the regime basis line still names the real per-class averages',
    /میانگین تغییر ۲۴ ساعته واقعی/.test(sectionText) && /رمزارز/.test(sectionText));
  check('cross: correlations still refuse anything short of real paired history',
    /همبستگی فقط با سری زمانی|Correlations need real paired history/.test(sectionText));

  await act(async () => { root.unmount(); });
  global.fetch = realFetch;
  console.error = realError;
  const realErrors = errors.filter((e) => !/Warning|act\(|Not implemented/i.test(e));
  check('cross: no fatal JS error was logged', realErrors.length === 0, realErrors[0]);

  return rows;
}
