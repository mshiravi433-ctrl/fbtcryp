/* ==========================================================================
   ui.js — the product surface
   --------------------------------------------------------------------------
   Every pixel of FBT Swap shown in the film is built here, in DOM, at stage
   scale. Real DOM (not canvas) is what makes the interface read as a real
   product: the type is hinting-correct, the panels have true hairlines and
   real shadows, and the spacing follows the 4pt grid the app uses.

   Naming follows the product's own vocabulary — Intent OS, INTENT STRUCTURED,
   CLARIFICATION REQUIRED, PROPOSED PLAN, USER APPROVAL REQUIRED — because the
   film must not invent a second, marketing-only version of the product.
   ========================================================================== */
import { TAU, clamp, lerp, rng, sprite, drawSprite, addBlend, roundRect, path as pth, text as txt, sparkline, candleRows } from './fx.js';

/* ── tiny DOM helper ──────────────────────────────────────────────────── */
export function el(tag, style = {}, html = '') {
  const n = document.createElement(tag);
  if (typeof style === 'string') n.className = style;
  else Object.assign(n.style, style);
  if (html) n.innerHTML = html;
  return n;
}
export function q(root, sel) { return root.querySelector(sel); }
export function qa(root, sel) { return [...root.querySelectorAll(sel)]; }

/* ── the brand mark ───────────────────────────────────────────────────── */
export function brandMark(size = 22, id = 'bm' + Math.floor(Math.random() * 1e6)) {
  const wrap = el('div', { width: size + 'px', height: size + 'px', position: 'relative', flex: '0 0 auto' });
  wrap.innerHTML = `
  <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke-width="2.1"
       stroke-linecap="round" stroke-linejoin="round" style="position:relative;z-index:2">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5cc9ff"/><stop offset="52%" stop-color="#7a5cff"/><stop offset="100%" stop-color="#2f7dff"/>
    </linearGradient></defs>
    <circle cx="12" cy="12" r="9.2" stroke="url(#${id})"/>
    <path d="M8.4 10.6a3.8 3.8 0 0 1 6.5-1.4" stroke="url(#${id})"/>
    <path d="M15.6 13.4a3.8 3.8 0 0 1-6.5 1.4" stroke="url(#${id})"/>
    <path d="M14.6 6.6v2.9h-2.9" stroke="url(#${id})"/>
    <path d="M9.4 17.4v-2.9h2.9" stroke="url(#${id})"/>
  </svg>`;
  return wrap;
}

export function brandLockup(size = 22, { sub = 'INTENT OS', scale = 1 } = {}) {
  const row = el('div', { display: 'flex', alignItems: 'center', gap: 11 * scale + 'px' });
  row.appendChild(brandMark(size));
  const col = el('div', { display: 'flex', flexDirection: 'column', lineHeight: '1.06' });
  const a = el('div', { fontSize: (15 * scale) + 'px', fontWeight: 700, letterSpacing: '-0.01em', color: '#fff' }, 'FBT Swap');
  const b = el('div', { fontFamily: "'JetBrains Mono', monospace", fontSize: (8.6 * scale) + 'px', letterSpacing: '0.2em', color: '#5d6c8c' }, sub);
  col.appendChild(a); col.appendChild(b);
  row.appendChild(col);
  return row;
}

/* ── browser window + phone shells ────────────────────────────────────── */
export function browserWindow({ w = 1400, h = 840, url = 'fbtswap.ir/intent', x = 260, y = 120 } = {}) {
  const win = el('div', 'window');
  Object.assign(win.style, { width: w + 'px', height: h + 'px', left: x + 'px', top: y + 'px' });
  const bar = el('div', 'bar');
  bar.innerHTML = `<span class="lamp"></span><span class="lamp"></span><span class="lamp"></span>
    <div class="url"><span class="lock"></span><span class="u">${url}</span></div>
    <div style="width:34px"></div>`;
  const body = el('div', { position: 'absolute', inset: '44px 0 0 0', overflow: 'hidden', background: '#05080f' });
  win.appendChild(bar); win.appendChild(body);
  return { root: win, body, bar };
}

export function phoneShell({ w = 380, h = 780, x = 0, y = 0 } = {}) {
  const ph = el('div', 'phone');
  Object.assign(ph.style, { width: w + 'px', height: h + 'px', left: x + 'px', top: y + 'px' });
  const screen = el('div', 'screen');
  const notch = el('div', 'notch');
  ph.appendChild(screen); ph.appendChild(notch);
  return { root: ph, screen };
}

export function appNav({ active = 'Intent OS', compact = false, scale = 1 } = {}) {
  const items = compact
    ? ['Swap', 'Intent OS', 'Portfolio']
    : ['Swap', 'Explore', 'Earn', 'Portfolio', 'Intent OS', 'Signals', 'Smart Money'];
  const nav = el('div', 'nav');
  nav.style.gap = (compact ? 14 : 26) * scale + 'px';
  const brand = el('div', 'brand');
  brand.appendChild(brandMark(compact ? 18 : 20));
  brand.appendChild(el('span', {}, 'FBT Swap'));
  nav.appendChild(brand);
  const mid = el('div', { display: 'flex', alignItems: 'center', gap: (compact ? 4 : 6) * scale + 'px', marginLeft: compact ? 'auto' : (18 * scale) + 'px' });
  for (const it of items) {
    const n = el('div', 'nav-item' + (it === active ? ' on' : ''), it);
    if (compact) n.style.fontSize = '11.5px';
    mid.appendChild(n);
  }
  nav.appendChild(mid);
  const right = el('div', { display: 'flex', alignItems: 'center', gap: 10 * scale + 'px', marginLeft: 'auto' });
  right.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;padding:7px 11px;border-radius:9px;border:1px solid rgba(255,255,255,.12);font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#93a3c4">
      <span style="width:6px;height:6px;border-radius:50%;background:#46d9a8;box-shadow:0 0 8px #46d9a8"></span>ETH
    </div>
    <div style="padding:8px 14px;border-radius:10px;background:linear-gradient(180deg,#3d86ff,#2064e6);font-size:${compact ? 11 : 12.5}px;font-weight:600;box-shadow:0 6px 18px rgba(38,105,230,.35)">Connect Wallet</div>`;
  nav.appendChild(right);
  return nav;
}

/* ── §03 · the Intent OS home screen ──────────────────────────────────── */
export const INTENT_CHIPS = [
  'Grow my portfolio', 'Protect capital', 'Explore opportunities', 'Generate yield',
  'Analyze an asset', 'Rebalance my portfolio', 'Create a strategy'
];

export function intentHome({ w, h, compact = false } = {}) {
  const root = el('div', { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', background: 'radial-gradient(120% 90% at 78% -10%, rgba(34,72,140,0.5), transparent 55%), radial-gradient(90% 70% at 10% 108%, rgba(74,52,150,0.28), transparent 60%), #05080f' });
  root.appendChild(appNav({ active: 'Intent OS', compact, scale: compact ? 0.85 : 1 }));

  const body = el('div', { flex: '1', position: 'relative', padding: compact ? '26px 20px' : '44px 64px', display: 'flex', flexDirection: 'column' });

  const kicker = el('div', 'kicker', 'FBT INTENT OS');
  kicker.style.marginBottom = compact ? '14px' : '22px';
  body.appendChild(kicker);

  const qa_ = el('div', 'display ' + (compact ? 'sm' : 'lg'));
  qa_.style.maxWidth = compact ? '100%' : '1080px';
  qa_.innerHTML = compact ? 'WHAT WOULD YOU<br/>LIKE TO ACHIEVE?' : 'WHAT WOULD YOU LIKE<br/>TO ACHIEVE?';
  body.appendChild(qa_);

  const sub = el('div', 'lead');
  sub.style.marginTop = compact ? '12px' : '18px';
  sub.style.maxWidth = compact ? '100%' : '720px';
  sub.style.fontSize = compact ? '13px' : '19px';
  sub.textContent = 'Describe your goal in your own words. Intent OS turns it into a structured, verifiable workflow.';
  body.appendChild(sub);

  const chipWrap = el('div', { display: 'flex', flexWrap: 'wrap', gap: compact ? '8px' : '12px', marginTop: compact ? '20px' : '34px', maxWidth: compact ? '100%' : '1000px' });
  INTENT_CHIPS.forEach((c, i) => {
    const chip = el('div', 'chip' + (i === 3 ? ' sel' : ''), `<span class="dot"></span>${c}`);
    if (compact) { chip.style.fontSize = '11px'; chip.style.padding = '7px 11px'; }
    chip.dataset.chip = c;
    chipWrap.appendChild(chip);
  });
  body.appendChild(chipWrap);

  const box = el('div', 'card');
  box.style.marginTop = compact ? '18px' : '30px';
  box.style.padding = compact ? '16px 16px 14px' : '24px 26px 22px';
  box.style.maxWidth = compact ? '100%' : '1080px';
  const lab = el('div', 'label', 'DESCRIBE YOUR GOAL');
  lab.style.marginBottom = '12px';
  const input = el('div', { fontSize: compact ? '14px' : '22px', lineHeight: '1.5', color: '#e8eeff', minHeight: compact ? '46px' : '66px', fontWeight: 400 });
  input.dataset.input = '1';
  const caret = el('span', { display: 'inline-block', width: '2px', height: compact ? '15px' : '22px', background: '#5cc9ff', verticalAlign: '-3px', marginLeft: '2px' });
  caret.className = 'blink';
  const foot = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: compact ? '12px' : '18px', paddingTop: compact ? '12px' : '18px', borderTop: '1px solid rgba(255,255,255,.07)' });
  foot.innerHTML = `<div style="display:flex;gap:14px;align-items:center">
      <div style="display:flex;align-items:center;gap:7px;font-family:'JetBrains Mono',monospace;font-size:${compact ? 9.5 : 11}px;color:#5d6c8c;letter-spacing:.16em">+ ATTACH CONTEXT</div>
      <div style="display:flex;align-items:center;gap:7px;font-family:'JetBrains Mono',monospace;font-size:${compact ? 9.5 : 11}px;color:#5d6c8c;letter-spacing:.16em">WALLET OPTIONAL</div>
    </div>
    <div data-interpret style="padding:${compact ? '9px 14px' : '12px 22px'};border-radius:10px;background:linear-gradient(180deg,#3d86ff,#2064e6);font-size:${compact ? 11.5 : 14}px;font-weight:600;box-shadow:0 8px 24px rgba(38,105,230,.34)">Interpret intent</div>`;
  box.appendChild(lab); box.appendChild(input); input.appendChild(caret); box.appendChild(foot);
  body.appendChild(box);

  root.appendChild(body);
  root.dataset.input = '1';
  return { root, input, caret, chips: qa(chipWrap, '.chip'), box, body };
}

/* ── §04 · intent interpretation ──────────────────────────────────────── */
export const PARSE_LAYERS = [
  { k: 'GOAL', v: 'Portfolio Growth', c: '#4d9bff' },
  { k: 'TIME HORIZON', v: '3 Years', c: '#5cc9ff' },
  { k: 'RISK', v: 'Controlled', c: '#9a86ff' },
  { k: 'CONTEXT', v: 'Portfolio', c: '#46d9a8' }
];

export function parseLayerCard({ compact = false } = {}) {
  const c = el('div', 'card');
  c.style.padding = compact ? '14px 15px' : '22px 24px';
  c.style.minWidth = compact ? '210px' : '300px';
  const k = el('div', 'label', '');
  const v = el('div', 'display xs');
  v.style.marginTop = '10px';
  c.appendChild(k); c.appendChild(v);
  c.dataset.k = k; c.dataset.v = v;
  return c;
}

/* ── §05 · context / wallet ───────────────────────────────────────────── */
export const PORTFOLIO_ROWS = [
  { s: 'ETH', n: 'Ethereum', a: '4.812', v: '$16,412.80', p: '+2.4%', up: true, c: '#7a86ff' },
  { s: 'USDC', n: 'USD Coin', a: '9,240.00', v: '$9,240.00', p: '0.0%', up: true, c: '#3d86ff' },
  { s: 'BTC', n: 'Bitcoin', a: '0.184', v: '$11,046.20', p: '+1.1%', up: true, c: '#ffb457' },
  { s: 'RWA', n: 'Tokenized T-Bills', a: '5,000.00', v: '$5,014.60', p: '+0.4%', up: true, c: '#46d9a8' },
  { s: 'Other', n: '6 assets', a: '—', v: '$3,208.40', p: '-0.7%', up: false, c: '#9a86ff' }
];

export function portfolioPanel({ compact = false } = {}) {
  const c = el('div', 'card');
  c.style.padding = compact ? '16px' : '24px';
  const head = el('div', 'row between');
  head.style.marginBottom = compact ? '14px' : '20px';
  head.innerHTML = `<div>
      <div class="label">PORTFOLIO · READ-ONLY</div>
      <div style="font-size:${compact ? 22 : 32}px;font-weight:700;letter-spacing:-.03em;margin-top:6px">$44,922.00</div>
    </div>`;
  const badge = el('div', 'badge mint', `<span class="led"></span>CONNECTED`);
  head.appendChild(badge);
  c.appendChild(head);
  const list = el('div');
  PORTFOLIO_ROWS.forEach((r) => {
    const row = el('div', 'row between');
    row.style.padding = compact ? '9px 0' : '13px 0';
    row.style.borderBottom = '1px solid rgba(255,255,255,.055)';
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:${compact ? 9 : 13}px">
        <div style="width:${compact ? 26 : 34}px;height:${compact ? 26 : 34}px;border-radius:50%;background:${r.c}22;border:1px solid ${r.c}66;display:grid;place-items:center;font-size:${compact ? 9 : 11}px;font-weight:700;color:${r.c}">${r.s.slice(0, 3)}</div>
        <div>
          <div style="font-size:${compact ? 12 : 14.5}px;font-weight:600">${r.s}</div>
          <div style="font-size:${compact ? 9.5 : 11.5}px;color:#5d6c8c">${r.n}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-family:'JetBrains Mono',monospace;font-size:${compact ? 11 : 13.5}px">${r.v}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:${compact ? 9.5 : 11.5}px;color:${r.up ? '#46d9a8' : '#ff5f78'}">${r.a} ${r.s === 'Other' ? 'base' : r.s}</div>
      </div>`;
    list.appendChild(row);
  });
  c.appendChild(list);
  return c;
}

export function walletSheet({ address = '0x7A3f…C4e1', compact = false } = {}) {
  const c = el('div', 'card');
  c.style.padding = compact ? '18px' : '26px';
  c.style.width = compact ? '100%' : '560px';
  c.innerHTML = `
    <div class="row between" style="margin-bottom:${compact ? 14 : 20}px">
      <div class="label">USER AUTHORIZATION REQUIRED</div>
      <div class="badge amber"><span class="led"></span>PENDING</div>
    </div>
    <div class="row" style="gap:14px">
      <div style="width:${compact ? 38 : 48}px;height:${compact ? 38 : 48}px;border-radius:13px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);display:grid;place-items:center">
        <div style="width:${compact ? 16 : 20}px;height:${compact ? 16 : 20}px;border-radius:50%;background:linear-gradient(140deg,#5cc9ff,#7a5cff)"></div>
      </div>
      <div style="flex:1">
        <div style="font-size:${compact ? 14 : 17}px;font-weight:600">Browser Wallet</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:${compact ? 11 : 13}px;color:#5d6c8c;margin-top:4px">${address}</div>
      </div>
    </div>
    <div style="margin-top:${compact ? 14 : 22}px">
      <div class="kv"><span class="k">Network</span><span class="v">Ethereum</span></div>
      <div class="kv"><span class="k">Requested scope</span><span class="v">Read balances</span></div>
      <div class="kv"><span class="k">Signing rights</span><span class="v" style="color:#46d9a8">None</span></div>
    </div>
    <div class="row" style="gap:12px;margin-top:${compact ? 16 : 24}px">
      <div class="btn ghost" style="flex:1">Reject</div>
      <div class="btn" style="flex:1.4">Approve</div>
    </div>
    <div class="tiny" style="margin-top:14px">Intent OS cannot move funds. Every action requires a separate, explicit authorization.</div>`;
  return c;
}

/* ── §06 · strategy plan ──────────────────────────────────────────────── */
export const PLAN_STEPS = [
  ['Analyze current portfolio', 'Reading balances, concentration and drift'],
  ['Identify concentration', 'Flagging single-asset exposure above policy'],
  ['Review market conditions', 'Volatility, liquidity depth and regime'],
  ['Evaluate opportunities', 'Comparing routes against the stated goal'],
  ['Define allocation framework', 'Target bands by risk budget and horizon'],
  ['Monitor risk', 'Continuous checks against the agreed limits']
];

export function planPanel({ compact = false } = {}) {
  const c = el('div', 'card');
  c.style.padding = compact ? '16px' : '26px';
  const head = el('div', 'row between');
  head.style.marginBottom = compact ? '12px' : '20px';
  head.innerHTML = `<div><div class="label">PROPOSED PLAN</div>
    <div style="font-size:${compact ? 15 : 19}px;font-weight:600;margin-top:6px">Structured strategy · not a guaranteed result</div></div>`;
  head.appendChild(el('div', 'badge blue', 'DRAFT'));
  c.appendChild(head);
  const list = el('div');
  PLAN_STEPS.forEach(([t, d], i) => {
    const row = el('div', { display: 'flex', gap: compact ? '10px' : '15px', padding: compact ? '9px 0' : '13px 0', borderBottom: i === PLAN_STEPS.length - 1 ? 'none' : '1px solid rgba(255,255,255,.055)' });
    row.dataset.step = String(i);
    row.innerHTML = `
      <div data-mark style="width:${compact ? 21 : 26}px;height:${compact ? 21 : 26}px;border-radius:50%;border:1px solid rgba(255,255,255,.18);display:grid;place-items:center;font-family:'JetBrains Mono',monospace;font-size:${compact ? 9.5 : 11}px;color:#93a3c4;flex:0 0 auto">${i + 1}</div>
      <div style="padding-top:1px">
        <div style="font-size:${compact ? 12 : 14.5}px;font-weight:600">${t}</div>
        <div style="font-size:${compact ? 10 : 12.5}px;color:#5d6c8c;margin-top:3px">${d}</div>
      </div>`;
    list.appendChild(row);
  });
  c.appendChild(list);
  return c;
}

/* ── §08 · action review ──────────────────────────────────────────────── */
export function actionCard({ compact = false } = {}) {
  const c = el('div', 'card active');
  c.style.padding = compact ? '18px' : '28px';
  c.style.width = compact ? '100%' : '640px';
  c.innerHTML = `
    <div class="row between" style="margin-bottom:${compact ? 14 : 22}px">
      <div><div class="label">PROPOSED ACTION</div>
        <div style="font-size:${compact ? 17 : 23}px;font-weight:700;letter-spacing:-.02em;margin-top:6px">Swap</div></div>
      <div class="badge violet"><span class="led"></span>AWAITING REVIEW</div>
    </div>

    <div style="display:flex;align-items:center;gap:${compact ? 10 : 16}px;padding:${compact ? '14px' : '20px'};border-radius:14px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)">
      <div style="flex:1">
        <div class="label">YOU PAY</div>
        <div style="font-size:${compact ? 20 : 27}px;font-weight:700;margin-top:6px">100 <span style="font-size:${compact ? 13 : 17}px;color:#93a3c4;font-weight:500">USDC</span></div>
      </div>
      <div style="width:${compact ? 30 : 40}px;height:${compact ? 30 : 40}px;border-radius:50%;border:1px solid rgba(255,255,255,.14);display:grid;place-items:center;color:#5cc9ff">→</div>
      <div style="flex:1;text-align:right">
        <div class="label">YOU RECEIVE</div>
        <div style="font-size:${compact ? 20 : 27}px;font-weight:700;margin-top:6px">≈0.0328 <span style="font-size:${compact ? 13 : 17}px;color:#93a3c4;font-weight:500">ETH</span></div>
      </div>
    </div>

    <div style="margin-top:${compact ? 12 : 20}px">
      <div class="kv"><span class="k">Network</span><span class="v">Ethereum</span></div>
      <div class="kv"><span class="k">Estimated network fee</span><span class="v">≈ 0.00042 ETH · $1.18</span></div>
      <div class="kv"><span class="k">Protocol fee</span><span class="v">0.25%</span></div>
      <div class="kv"><span class="k">Max slippage</span><span class="v">0.50%</span></div>
      <div class="kv"><span class="k">Destination</span><span class="v">0x7A3f…C4e1</span></div>
      <div class="kv"><span class="k">Route</span><span class="v">USDC → WETH</span></div>
    </div>

    <div class="row" style="gap:12px;margin-top:${compact ? 16 : 24}px">
      <div class="btn ghost" style="flex:1">Decline</div>
      <div class="btn" data-confirm style="flex:1.6">Review &amp; Confirm</div>
    </div>
    <div class="tiny" style="margin-top:14px">Estimates are not guarantees. Final amounts are determined at execution.</div>`;
  return c;
}

/* ── §07 · capability network ─────────────────────────────────────────── */
export const MODULES = [
  { id: 'market', label: 'MARKET', sub: 'Prices · depth · volatility' },
  { id: 'signal', label: 'SIGNAL', sub: 'Technical context' },
  { id: 'smart', label: 'SMART MONEY', sub: 'On-chain flows' },
  { id: 'wallet', label: 'WALLET', sub: 'Balances · allowances' },
  { id: 'swap', label: 'SWAP', sub: 'Routing · execution' },
  { id: 'lending', label: 'LENDING', sub: 'Rates · collateral' },
  { id: 'rwa', label: 'RWA', sub: 'Tokenized assets' },
  { id: 'earn', label: 'EARN', sub: 'Yield venues' },
  { id: 'futures', label: 'FUTURES', sub: 'Perps · funding' },
  { id: 'explore', label: 'EXPLORE', sub: 'Discovery layer' }
];

export function moduleNode(m, compact = false) {
  const n = el('div', 'card flat');
  n.style.padding = compact ? '12px 14px' : '16px 20px';
  n.style.minWidth = compact ? '150px' : '196px';
  n.dataset.module = m.id;
  n.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
      <span style="width:7px;height:7px;border-radius:50%;background:#4d9bff;box-shadow:0 0 10px #4d9bff"></span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:${compact ? 10.5 : 12}px;letter-spacing:.18em;font-weight:700;color:#e8eeff">${m.label}</span>
    </div>
    <div style="font-size:${compact ? 10 : 11.5}px;color:#5d6c8c;margin-top:7px">${m.sub}</div>`;
  return n;
}

/* ── §09 · execution status rail ──────────────────────────────────────── */
export const EXEC_STEPS = ['PREPARING', 'SUBMITTED', 'CONFIRMING', 'CONFIRMED'];

export function execPanel({ compact = false } = {}) {
  const c = el('div', 'card');
  c.style.padding = compact ? '16px' : '26px';
  c.style.width = compact ? '100%' : '600px';
  const steps = el('div', { display: 'flex', flexDirection: 'column', gap: compact ? '11px' : '16px' });
  EXEC_STEPS.forEach((s, i) => {
    const row = el('div', { display: 'flex', alignItems: 'center', gap: compact ? '11px' : '15px' });
    row.dataset.exec = s;
    row.innerHTML = `
      <span data-dot style="width:${compact ? 9 : 11}px;height:${compact ? 9 : 11}px;border-radius:50%;background:rgba(255,255,255,.12);flex:0 0 auto;transition:none"></span>
      <span data-txt style="font-family:'JetBrains Mono',monospace;font-size:${compact ? 11 : 13}px;letter-spacing:.2em;color:#3b4761">${s}</span>
      <span data-meta style="margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:${compact ? 10 : 11.5}px;color:#3b4761"></span>`;
    steps.appendChild(row);
  });
  c.appendChild(el('div', 'label', 'EXECUTION'));
  c.appendChild(steps);
  const hash = el('div', { marginTop: compact ? '14px' : '22px', paddingTop: compact ? '12px' : '18px', borderTop: '1px solid rgba(255,255,255,.07)' });
  hash.innerHTML = `<div class="label">TRANSACTION HASH</div>
    <div data-hash style="font-family:'JetBrains Mono',monospace;font-size:${compact ? 10.5 : 12.5}px;color:#93a3c4;margin-top:8px;word-break:break-all;opacity:0">0x9c41f7b2a8e04d6…e17b3ac9</div>
    <div class="tiny" style="margin-top:8px;opacity:0" data-note>Example hash — the film never shows a fabricated on-chain record as if it were real.</div>`;
  c.appendChild(hash);
  return { root: c, steps, hash };
}

/* ── §10 · monitoring ─────────────────────────────────────────────────── */
export function monitorPanel({ compact = false } = {}) {
  const c = el('div', 'card');
  c.style.padding = compact ? '16px' : '24px';
  c.style.width = compact ? '100%' : '520px';
  c.innerHTML = `
    <div class="row between" style="margin-bottom:${compact ? 12 : 18}px">
      <div class="label">MONITORING</div>
      <div class="badge blue"><span class="led"></span>LIVE</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:${compact ? 10 : 14}px">
      <div style="padding:${compact ? 11 : 15}px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)">
        <div class="label">VOLATILITY</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:${compact ? 15 : 19}px;color:#ffb457;margin-top:7px">38.2</div>
        <div style="font-size:${compact ? 9.5 : 11}px;color:#5d6c8c;margin-top:4px">+9.4 over 24h</div>
      </div>
      <div style="padding:${compact ? 11 : 15}px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)">
        <div class="label">LARGEST POSITION</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:${compact ? 15 : 19}px;margin-top:7px">ETH 41.6%</div>
        <div style="font-size:${compact ? 9.5 : 11}px;color:#5d6c8c;margin-top:4px">Policy band 35–40%</div>
      </div>
    </div>
    <div style="margin-top:${compact ? 12 : 18}px"></div>`;
  return c;
}

/* ── shared scroll/typing pose helpers ────────────────────────────────── */
export function typeInto(node, full, t, { cps = 26, start = 0 } = {}) {
  const n = Math.max(0, Math.min(full.length, Math.floor((t - start) * cps)));
  node.textContent = full.slice(0, n);
  return n >= full.length;
}

/** Pose a list of elements with a staggered reveal. */
export function reveal(node, k, { y = 18, x = 0 } = {}) {
  const a = clamp(k);
  node.style.opacity = a;
  node.style.transform = `translate3d(${(1 - a) * x}px, ${(1 - a) * y}px, 0)`;
}

/* ── canvas bokeh helper used by several scenes ──────────────────────── */
export function bokehCluster(ctx, cx, cy, seedN, t, { count = 26, radius = 260, color = 'rgba(120,175,255,1)', speed = 0.6 } = {}) {
  const r = rng(seedN);
  const spr = sprite(color, 0.55);
  addBlend(ctx, true);
  for (let i = 0; i < count; i++) {
    const a = r() * TAU, d = Math.pow(r(), 0.6) * radius;
    const x = cx + Math.cos(a + t * 0.05 * speed) * d;
    const y = cy + Math.sin(a + t * 0.05 * speed) * d * 0.6;
    drawSprite(ctx, spr, x, y, 30 + r() * 150, 0.05 + 0.09 * r());
  }
  addBlend(ctx, false);
}


/* ── camera helpers for DOM scenes ─────────────────────────────────────
   Scenes live inside #world, so a cursor that must land on a real element
   has to be expressed in world coordinates. CTM inverts the stage
   transform: O + (stage − O − d)/s. */
export function stageToWorld(p, { dx = 0, dy = 0, scale = 1, ox = 960, oy = 540 } = {}) {
  return { x: ox + (p.x - ox - dx) / scale, y: oy + (p.y - oy - dy) / scale };
}

export function stagePoint(node, stageEl = document.getElementById('stage')) {
  const b = node.getBoundingClientRect();
  const s = stageEl.getBoundingClientRect();
  return { x: b.left - s.left + b.width / 2, y: b.top - s.top + b.height / 2, w: b.width, h: b.height };
}

export function cursorSprite() {
  const c = el('div', 'cursor');
  c.innerHTML = `<div class="ring"></div><svg class="arrow" width="14" height="20" viewBox="0 0 14 20"><path d="M1 1l11 11-5 .6L9.6 18 7 19 5 13 1 1z" fill="#fff"/></svg>`;
  return c;
}
