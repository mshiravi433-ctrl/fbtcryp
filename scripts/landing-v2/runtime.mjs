/**
 * LANDING 2.0 — CLIENT RUNTIME (vanilla JS, inlined into the page).
 * ---------------------------------------------------------------------------
 * Exported as a plain string so scripts/landing-v2/index.mjs can inline it.
 * It deliberately contains NO template literals and NO `</script>` substring
 * so the string can sit inside both a generator template and <script>.
 *
 * What it does, and ONLY what it does:
 *
 *   1. Language switching (EN ⇄ FA) with localStorage persistence — the
 *      visible language is decided by a single data-lang attribute; every
 *      bilingual string already exists in the DOM exactly once per language.
 *   2. Live data from the app's own public API (same origin):
 *        /api/global /api/markets /api/trending /api/yields /api/solana/assets
 *      Nothing is fabricated: any fetch that fails leaves an honest
 *      "Data unavailable" state with a Retry button.
 *   3. Small presentation helpers: scroll reveal, sticky-nav state, mobile
 *      menu, typewriter sample in the hero console.
 *
 * All dynamic text goes through textContent — API data is never trusted as
 * HTML, even though the source is our own backend.
 */

export const RUNTIME = /* js */ `
(function () {
  'use strict';

  var CFG = window.__FBT_L10N__ || {};
  var html = document.documentElement;
  var LS_KEY = 'fbt-landing-lang';
  var RM = false;
  try { RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* ------------------------------------------------ language switching --- */

  /** @returns {'en'|'fa'} */
  function currentLang() { return html.getAttribute('data-lang') === 'fa' ? 'fa' : 'en'; }

  /** Locales: Persian visitors see Persian numerals; English stays Latin. */
  function nf(opts) {
    try { return new Intl.NumberFormat(currentLang() === 'fa' ? 'fa-IR' : 'en-US', opts); }
    catch (e) { return new Intl.NumberFormat('en-US', opts); }
  }
  function dict(group) {
    var g = CFG[group] || {};
    return g[currentLang()] || g.en || {};
  }

  function setLang(lang, persist) {
    lang = lang === 'fa' ? 'fa' : 'en';
    html.setAttribute('data-lang', lang);
    html.setAttribute('lang', lang);
    html.setAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
    var m = CFG.meta && CFG.meta[lang];
    if (m) {
      document.title = m.title;
      var d = document.querySelector('meta[name="description"]');
      if (d) d.setAttribute('content', m.description);
      var ogT = document.querySelector('meta[property="og:title"]');
      if (ogT) ogT.setAttribute('content', m.title);
      var ogD = document.querySelector('meta[property="og:description"]');
      if (ogD) ogD.setAttribute('content', m.description);
    }
    var btns = document.querySelectorAll('[data-setlang]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-setlang') === lang));
    }
    if (persist) { try { localStorage.setItem(LS_KEY, lang); } catch (e) {} }
    rerenderDynamic();
    typewriter.reset();
  }

  /* --------------------------------------------------- number helpers --- */

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /** Compact magnitude with an unambiguous Latin unit (T/B/M) in both languages. */
  function compact(v) {
    if (!isNum(v)) return '—';
    var abs = Math.abs(v), div = 1, suffix = '';
    if (abs >= 1e12) { div = 1e12; suffix = 'T'; }
    else if (abs >= 1e9) { div = 1e9; suffix = 'B'; }
    else if (abs >= 1e6) { div = 1e6; suffix = 'M'; }
    else if (abs >= 1e3) { div = 1e3; suffix = 'K'; }
    var mant = v / div;
    var digits = abs / div >= 100 ? 0 : abs / div >= 10 ? 1 : 2;
    return nf({ maximumFractionDigits: digits }).format(mant) + suffix;
  }
  function usd(v) { return isNum(v) ? '$' + compact(v) : '—'; }
  function price(v) {
    if (!isNum(v)) return '—';
    var digits = v >= 1000 ? 0 : v >= 100 ? 2 : v >= 1 ? 2 : v >= 0.01 ? 4 : 6;
    return '$' + nf({ minimumFractionDigits: 0, maximumFractionDigits: digits }).format(v);
  }
  function pct(v) {
    if (!isNum(v)) return { text: '—', cls: 'flat' };
    var cls = v > 0.005 ? 'up' : v < -0.005 ? 'down' : 'flat';
    var sign = v > 0 ? '+' : '';
    return { text: sign + nf({ maximumFractionDigits: 2 }).format(v) + '%', cls: cls };
  }
  function whole(v) { return isNum(v) ? nf({ maximumFractionDigits: 0 }).format(v) : '—'; }
  function timeNow() {
    try {
      return new Intl.DateTimeFormat(currentLang() === 'fa' ? 'fa-IR' : 'en-US', { hour: '2-digit', minute: '2-digit' }).format(new Date());
    } catch (e) { return new Date().toISOString().slice(11, 16); }
  }

  /* ----------------------------------------------------- DOM helpers ---- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function $(sel) { return document.querySelector(sel); }

  /** Replace a container's contents with skeleton-free real rows. */
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  /**
   * Honest failure state. The rule for this page is absolute: data either
   * came live from the API or the UI says it is unavailable. Never a guess.
   */
  function showUnavailable(container, sourceKey) {
    if (!container) return;
    clear(container);
    var L = dict('states');
    var box = el('div', 'empty-state');
    box.appendChild(el('p', null, L.unavailable + ' — ' + L.tryAgain));
    var btn = el('button', 'retry-btn', L.retry);
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-retry', sourceKey);
    box.appendChild(btn);
    container.appendChild(box);
  }

  /** Tiny 7d sparkline from an API-provided numeric series (our own backend). */
  function sparklineSVG(points, up) {
    if (!points || points.length < 2) return null;
    var w = 104, h = 30, pad = 2;
    var min = Math.min.apply(null, points), max = Math.max.apply(null, points);
    var span = max - min || 1;
    var stepX = (w - pad * 2) / (points.length - 1);
    var d = '';
    for (var i = 0; i < points.length; i++) {
      var x = pad + i * stepX;
      var y = pad + (h - pad * 2) * (1 - (points[i] - min) / span);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('class', 'spark');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', up ? 'var(--lime)' : 'var(--red)');
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
    return svg;
  }

  /* ------------------------------------------------ data layer ---------- */

  var DATA = { global: null, markets: null, trending: null, yields: null, solana: null };
  var TTL = { global: 60000, markets: 60000, trending: 180000, yields: 600000, solana: 300000 };
  var URLS = {
    global: '/api/global',
    markets: '/api/markets?page=1&per_page=50&vs=usd',
    trending: '/api/trending',
    yields: '/api/yields',
    solana: '/api/solana/assets'
  };

  function cacheKey(k) { return 'fbtl2:' + k; }
  function readCache(k) {
    try {
      var raw = sessionStorage.getItem(cacheKey(k));
      if (!raw) return null;
      var rec = JSON.parse(raw);
      if (!rec || typeof rec.t !== 'number' || Date.now() - rec.t > (TTL[k] || 60000)) return null;
      return rec.d;
    } catch (e) { return null; }
  }
  function writeCache(k, d) {
    try { sessionStorage.setItem(cacheKey(k), JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}
  }

  function fetchJSON(url, timeout) {
    return new Promise(function (resolve, reject) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); reject(new Error('timeout')); }, timeout || 12000);
      fetch(url, { headers: { accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (json) { clearTimeout(timer); resolve(json); })
        .catch(function (err) { clearTimeout(timer); reject(err); });
    });
  }

  /**
   * Load one feed: session cache first, then the network. A rejection never
   * escapes into the page — a failed feed marks its sections unavailable.
   */
  function load(key, force) {
    return new Promise(function (resolve) {
      if (!force) {
        var cached = readCache(key);
        if (cached) { DATA[key] = cached; resolve(true); return; }
        if (DATA[key]) { resolve(true); return; }
      }
      fetchJSON(URLS[key])
        .then(function (json) {
          DATA[key] = json;
          writeCache(key, json);
          resolve(true);
        })
        .catch(function () { resolve(false); });
    });
  }

  function markUpdated() {
    var nodes = document.querySelectorAll('[data-updated]');
    var L = dict('states');
    var stamp = L.updated + ' ' + timeNow();
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = stamp;
  }

  /* ------------------------------------------------ renderers ----------- */
  /* Every renderer is pure: wipe the container, rebuild from DATA. They are
     re-run on language switch so numerals and localized labels follow. */

  function renderPulse() {
    var g = DATA.global;
    if (!g) return;
    var chg = pct(g.mcapChange);
    setText('#pv-mcap', usd(g.mcap));
    setText('#pv-vol', usd(g.volume));
    setText('#pv-btcd', isNum(g.btcDominance) ? nf({ maximumFractionDigits: 1 }).format(g.btcDominance) + '%' : '—');
    var node = $('#pv-chg');
    if (node) { node.textContent = chg.text; node.classList.remove('up', 'down', 'flat'); node.classList.add(chg.cls); }
    var arrow = $('#pv-chg-dir');
    if (arrow) arrow.textContent = chg.cls === 'up' ? '▲' : chg.cls === 'down' ? '▼' : '•';
  }

  function setText(sel, txt) { var n = $(sel); if (n) n.textContent = txt; }

  function coinCell(c) {
    var wrap = el('span', 'coin-cell');
    if (c.image) {
      var img = document.createElement('img');
      img.src = c.image;
      img.alt = '';
      img.width = 26; img.height = 26;
      img.loading = 'lazy'; img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      wrap.appendChild(img);
    }
    var col = el('span', null);
    col.appendChild(el('span', 'sym', c.symbol || '—'));
    col.appendChild(el('span', 'name', c.name || ''));
    wrap.appendChild(col);
    return wrap;
  }

  function changeCell(v) {
    var p = pct(v);
    var s = el('span', 'chg ' + p.cls, p.text);
    return s;
  }

  var TOKEN_ROWS = 10;
  function renderTokens() {
    var tbody = $('#tokens-tbody');
    if (!tbody || !Array.isArray(DATA.markets)) return;
    clear(tbody);
    var rows = DATA.markets.slice(0, TOKEN_ROWS);
    for (var i = 0; i < rows.length; i++) {
      (function (c, idx) {
        var tr = document.createElement('tr');
        var tdA = el('td');
        var cell = coinCell(c);
        var rk = el('span', 'rank', String(c.rank || idx + 1));
        cell.insertBefore(rk, cell.firstChild);
        tdA.appendChild(cell);
        var tdP = el('td'); tdP.appendChild(el('span', 'num', price(c.price)));
        var tdC = el('td'); tdC.appendChild(changeCell(c.change24h));
        var tdV = el('td'); tdV.appendChild(el('span', 'num', usd(c.volume)));
        var tdM = el('td'); tdM.appendChild(el('span', 'num', usd(c.mcap)));
        var tdT = el('td');
        var spark = sparklineSVG(c.sparkline, isNum(c.change7d) ? c.change7d >= 0 : true);
        if (spark) tdT.appendChild(spark); else tdT.textContent = '—';
        tr.appendChild(tdA); tr.appendChild(tdP); tr.appendChild(tdC);
        tr.appendChild(tdV); tr.appendChild(tdM); tr.appendChild(tdT);
        tbody.appendChild(tr);
      })(rows[i], i);
    }
  }

  /** Hero mockup: fill the BTC/ETH/SOL/BNB rows + portfolio sparkline. */
  function renderHeroMarket() {
    if (!Array.isArray(DATA.markets)) return;
    var wanted = { 'hm-bitcoin': 'bitcoin', 'hm-ethereum': 'ethereum', 'hm-solana': 'solana', 'hm-binance': 'binancecoin' };
    for (var id in wanted) {
      var coin = null;
      for (var i = 0; i < DATA.markets.length; i++) if (DATA.markets[i].id === wanted[id]) coin = DATA.markets[i];
      var pNode = $('#' + id + '-p'), cNode = $('#' + id + '-c');
      if (coin && pNode) pNode.textContent = price(coin.price);
      if (coin && cNode) {
        var p = pct(coin.change24h);
        cNode.textContent = p.text;
        cNode.className = 'chg ' + p.cls;
      }
    }
    var btc = null;
    for (var j = 0; j < DATA.markets.length; j++) if (DATA.markets[j].id === 'bitcoin') btc = DATA.markets[j];
    if (!btc) return;
    setText('#dp-price', price(btc.price));
    var ch = pct(btc.change24h);
    var chn = $('#dp-chg');
    if (chn) { chn.textContent = ch.text + ' · BTC'; chn.className = 'mini-kpi ' + ch.cls; }
    var sparkHost = $('#dp-spark');
    if (sparkHost) {
      clear(sparkHost);
      var s = sparklineSVG(btc.sparkline, isNum(btc.change7d) ? btc.change7d >= 0 : true);
      if (s) sparkHost.appendChild(s);
    }
  }

  function renderStocks() {
    var host = $('#stocks-rows');
    if (!host || !DATA.solana) return;
    clear(host);
    var eq = Array.isArray(DATA.solana.equities) ? DATA.solana.equities.slice() : [];
    eq.sort(function (a, b) { return (b.liquidity || 0) - (a.liquidity || 0); });
    eq = eq.slice(0, 4);
    if (!eq.length) { showUnavailable(host, 'solana'); return; }
    for (var i = 0; i < eq.length; i++) {
      (function (r) {
        var line = el('div', 'rowline');
        var left = el('div', 'grow');
        left.appendChild(el('div', 'name', r.symbol || '—'));
        left.appendChild(el('div', 'sub', r.name || ''));
        var right = el('div', 'val');
        right.appendChild(el('div', 'num', price(r.usdPrice)));
        var sub = el('div', 'sub');
        sub.appendChild(changeCell(r.change24h));
        right.appendChild(sub);
        line.appendChild(left);
        line.appendChild(right);
        host.appendChild(line);
      })(eq[i]);
    }
  }

  var farmsFilter = 'all';
  function renderFarms() {
    var host = $('#farms-rows');
    if (!host || !DATA.yields) return;
    clear(host);
    var pools = Array.isArray(DATA.yields.pools) ? DATA.yields.pools : [];
    var filtered = pools.filter(function (p) {
      if (farmsFilter === 'all') return true;
      if (farmsFilter === 'high') return isNum(p.apy) && p.apy >= 10;
      return p.risk === farmsFilter;
    }).slice(0, 8);
    if (!filtered.length) { showUnavailable(host, 'yields'); return; }
    var riskLabels = dict('risks');
    for (var i = 0; i < filtered.length; i++) {
      (function (p) {
        var line = el('div', 'rowline');
        var left = el('div', 'grow');
        left.appendChild(el('div', 'name', (p.symbol || '—') + ' · ' + (p.project || '')));
        left.appendChild(el('div', 'sub', p.chain || ''));
        var mid = el('div', 'val');
        mid.appendChild(el('div', 'num up', isNum(p.apy) ? nf({ maximumFractionDigits: 1 }).format(p.apy) + '%' : '—'));
        mid.appendChild(el('div', 'sub', 'APY'));
        var tvl = el('div', 'val');
        tvl.appendChild(el('div', 'num', usd(p.tvlUsd)));
        tvl.appendChild(el('div', 'sub', 'TVL'));
        var rb = el('span', 'rb rb-' + (p.risk || 'medium'), riskLabels[p.risk] || p.risk || '—');
        line.appendChild(left);
        line.appendChild(mid);
        line.appendChild(tvl);
        line.appendChild(rb);
        host.appendChild(line);
      })(filtered[i]);
    }
    var note = $('#farms-considered');
    if (note && isNum(DATA.yields.passed) && isNum(DATA.yields.considered)) {
      note.textContent = whole(DATA.yields.passed) + ' / ' + whole(DATA.yields.considered);
    }
  }

  function renderSolana() {
    var host = $('#solana-rows');
    if (!host || !DATA.solana) return;
    clear(host);
    var lst = Array.isArray(DATA.solana.lst) ? DATA.solana.lst.slice(0, 5) : [];
    if (!lst.length) { showUnavailable(host, 'solana'); return; }
    var L = dict('solana');
    for (var i = 0; i < lst.length; i++) {
      (function (r) {
        var line = el('div', 'rowline');
        var left = el('div', 'grow');
        left.appendChild(el('div', 'name', r.symbol || '—'));
        left.appendChild(el('div', 'sub', (r.name || '') + (L.lst ? ' · ' + L.lst : '')));
        var right = el('div', 'val');
        right.appendChild(el('div', 'num', price(r.usdPrice)));
        var sub = el('div', 'sub');
        sub.appendChild(changeCell(r.change24h));
        right.appendChild(sub);
        line.appendChild(left);
        line.appendChild(right);
        host.appendChild(line);
      })(lst[i]);
    }
  }

  /** Market Overview dashboard cards. */
  function renderMarketDash() {
    var g = DATA.global, m = DATA.markets, t = DATA.trending;
    if (g) {
      var chg = pct(g.mcapChange);
      setText('#md-mcap', usd(g.mcap));
      var mc = $('#md-mcap-c');
      if (mc) { mc.textContent = chg.text; mc.className = 'num ' + chg.cls; }
      setText('#md-vol', usd(g.volume));
      setText('#md-btcd', isNum(g.btcDominance) ? nf({ maximumFractionDigits: 1 }).format(g.btcDominance) + '%' : '—');
    }
    if (Array.isArray(m) && m.length) {
      var withChg = m.filter(function (c) { return isNum(c.change24h); });
      withChg.sort(function (a, b) { return b.change24h - a.change24h; });
      var top = withChg[0], bot = withChg[withChg.length - 1];
      if (top) {
        setText('#md-gainer-s', top.symbol || '—');
        var gn = $('#md-gainer-c');
        if (gn) { var p = pct(top.change24h); gn.textContent = p.text; gn.className = 'num ' + p.cls; }
      }
      if (bot) {
        setText('#md-loser-s', bot.symbol || '—');
        var ln = $('#md-loser-c');
        if (ln) { var p2 = pct(bot.change24h); ln.textContent = p2.text; ln.className = 'num ' + p2.cls; }
      }
    }
    if (Array.isArray(t) && t.length && t[0]) {
      setText('#md-trend-s', (t[0].symbol || '—') + '');
      setText('#md-trend-c', t[0].name || '');
    }
  }

  function renderOpportunities() {
    /* Trending: real rows from /api/trending (symbol, image, market rank). */
    var host = $('#opp-trending');
    if (host && Array.isArray(DATA.trending)) {
      clear(host);
      var L = dict('opp');
      DATA.trending.slice(0, 3).forEach(function (c) {
        var item = el('div', 'opp-item');
        if (c.image) {
          var img = document.createElement('img');
          img.src = c.image; img.alt = ''; img.width = 22; img.height = 22;
          img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
          item.appendChild(img);
        }
        item.appendChild(el('span', 'grow', (c.symbol || '—') + ' ' + (c.name ? '' : '')));
        item.appendChild(el('span', 'meta', c.rank ? L.rank + ' ' + whole(c.rank) : ''));
        host.appendChild(item);
      });
      if (!DATA.trending.length) showUnavailable(host, 'trending');
    }
    /* Yield: top two filtered pools, same source as the farms table. */
    var yHost = $('#opp-yield');
    if (yHost && DATA.yields && Array.isArray(DATA.yields.pools)) {
      clear(yHost);
      var L2 = dict('opp');
      DATA.yields.pools.slice(0, 2).forEach(function (p) {
        var item = el('div', 'opp-item');
        item.appendChild(el('span', 'grow', (p.symbol || '—') + ' · ' + (p.project || '')));
        var meta = el('span', 'meta up');
        meta.textContent = (isNum(p.apy) ? nf({ maximumFractionDigits: 1 }).format(p.apy) + '% ' + L2.apy : '') +
          (isNum(p.tvlUsd) ? ' · ' + usd(p.tvlUsd) + ' ' + L2.tvl : '');
        item.appendChild(meta);
        yHost.appendChild(item);
      });
      if (!DATA.yields.pools.length) showUnavailable(yHost, 'yields');
    }
  }

  /** Hero mini yield panel: top two live pools (skeleton stays until data). */
  function renderHeroYield() {
    if (!DATA.yields || !Array.isArray(DATA.yields.pools)) return;
    var host = $('#dy-rows');
    if (!host) return;
    clear(host);
    DATA.yields.pools.slice(0, 2).forEach(function (p) {
      var line = el('div', 'mrow');
      line.appendChild(el('span', 't', p.symbol || '—'));
      var sp = el('span', null, p.project || '');
      line.appendChild(sp);
      var v = el('span', 'chg up', isNum(p.apy) ? nf({ maximumFractionDigits: 1 }).format(p.apy) + '%' : '—');
      v.style.marginInlineStart = 'auto';
      line.appendChild(v);
      host.appendChild(line);
    });
  }

  /* ------------------------------------------------ orchestration ------- */

  var RENDERERS = [renderPulse, renderHeroMarket, renderTokens, renderStocks, renderFarms, renderSolana, renderMarketDash, renderOpportunities, renderHeroYield];
  function rerenderDynamic() {
    for (var i = 0; i < RENDERERS.length; i++) {
      try { RENDERERS[i](); } catch (e) {}
    }
    markUpdated();
  }

  /**
   * Failure states, per feed. A table keeps its skeleton replaced by a
   * single honest row (so a Retry can re-fill the same tbody), list hosts
   * get the boxed unavailable state.
   */
  function tableFail(tbodySel, cols, key) {
    var tbody = $(tbodySel);
    if (!tbody) return;
    clear(tbody);
    var L = dict('states');
    var tr = document.createElement('tr');
    var td = el('td', 'empty-state', L.unavailable + ' ');
    td.setAttribute('colspan', String(cols));
    var btn = el('button', 'retry-btn', L.retry);
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-retry', key);
    td.appendChild(btn);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  function onFeedFail(key) {
    if (key === 'global') {
      document.querySelectorAll('[data-dyn-global]').forEach(function (n) { n.textContent = '—'; });
      var note = $('#pulse-note');
      var L = dict('states');
      if (note) note.textContent = L.unavailable;
    }
    if (key === 'markets') tableFail('#tokens-tbody', 6, 'markets');
    if (key === 'trending') showUnavailable($('#opp-trending'), 'trending');
    if (key === 'yields') {
      showUnavailable($('#farms-rows'), 'yields');
      showUnavailable($('#opp-yield'), 'yields');
      showUnavailable($('#dy-rows'), 'yields');
    }
    if (key === 'solana') {
      showUnavailable($('#stocks-rows'), 'solana');
      showUnavailable($('#solana-rows'), 'solana');
    }
  }

  function loadAll(force) {
    var keys = ['global', 'markets', 'trending', 'yields', 'solana'];
    return Promise.all(keys.map(function (k) {
      return load(k, force).then(function (ok) {
        if (!ok) onFeedFail(k);
      });
    })).then(rerenderDynamic);
  }

  /* Retry buttons (event delegation: one listener for all of them). */
  document.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('[data-retry]') : null;
    if (!btn) return;
    var key = btn.getAttribute('data-retry');
    if (!URLS[key]) return;
    load(key, true).then(function (ok) {
      if (ok) rerenderDynamic();
    });
  });

  /* Farm risk filter chips. */
  document.addEventListener('click', function (ev) {
    var chip = ev.target && ev.target.closest ? ev.target.closest('[data-farm-filter]') : null;
    if (!chip) return;
    farmsFilter = chip.getAttribute('data-farm-filter');
    document.querySelectorAll('[data-farm-filter]').forEach(function (c) {
      c.setAttribute('aria-pressed', String(c === chip));
    });
    renderFarms();
  });

  /* Language switcher. */
  document.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('[data-setlang]') : null;
    if (!btn) return;
    setLang(btn.getAttribute('data-setlang'), true);
  });

  /* ------------------------------------------------ chrome -------------- */

  function initNav() {
    var nav = $('#site-nav');
    if (!nav) return;
    var onScroll = function () {
      if (window.scrollY > 8) nav.classList.add('scrolled'); else nav.classList.remove('scrolled');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    var toggle = $('#menu-toggle');
    var menu = $('#mobile-menu');
    if (toggle && menu) {
      toggle.addEventListener('click', function () {
        var open = menu.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
      });
      menu.addEventListener('click', function (ev) {
        if (ev.target && ev.target.tagName === 'A') {
          menu.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    }
  }

  /** Scroll reveal + the intent pipeline cascade. No-JS visitors are never
      affected: hiding only happens when this runtime marks html[data-js]. */
  function initReveal() {
    html.setAttribute('data-js', '1');
    if (RM || typeof IntersectionObserver === 'undefined') {
      document.querySelectorAll('.reveal').forEach(function (n) { n.classList.add('in'); });
      document.querySelectorAll('.flow li').forEach(function (n) { n.classList.add('on'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        e.target.querySelectorAll('.flow li').forEach(function (li) { li.classList.add('on'); });
        if (e.target.classList.contains('flow-host')) {
          e.target.querySelectorAll('.flow li').forEach(function (li) { li.classList.add('on'); });
        }
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    document.querySelectorAll('.reveal').forEach(function (n) { io.observe(n); });
  }

  /* Rotating sample intent in the hero console — clearly an illustration,
     it types the three example prompts from the copy dictionary. */
  var typewriter = (function () {
    var node = null, timer = null, idx = 0, pos = 0, deleting = false;
    function lines() {
      var L = CFG.intents || {};
      return (L[currentLang()] || L.en) || [];
    }
    function step() {
      if (!node) return;
      var arr = lines();
      if (!arr.length) return;
      var full = arr[idx % arr.length];
      if (!deleting) {
        pos++;
        node.textContent = full.slice(0, pos);
        if (pos >= full.length) { deleting = true; timer = setTimeout(step, 2100); return; }
        timer = setTimeout(step, 26 + Math.random() * 34);
      } else {
        pos--;
        node.textContent = full.slice(0, Math.max(0, pos));
        if (pos <= 0) { deleting = false; idx++; timer = setTimeout(step, 420); return; }
        timer = setTimeout(step, 13);
      }
    }
    return {
      start: function () {
        node = $('#tw-intent');
        if (!node) return;
        var arr = lines();
        if (!arr.length) return;
        if (RM) { node.textContent = arr[0]; return; }
        timer = setTimeout(step, 600);
      },
      reset: function () {
        idx = 0; pos = 0; deleting = false;
        if (timer) { clearTimeout(timer); timer = null; }
        if (node && RM) { var arr = lines(); if (arr.length) node.textContent = arr[0]; }
        else if (node) { node.textContent = ''; timer = setTimeout(step, 300); }
      }
    };
  })();

  /* ------------------------------------------------ boot ------------------ */

  function boot() {
    /* Saved language wins over the English default — same rule the
       pre-paint script applied, repeated here so button state matches. */
    var saved = null;
    try { saved = localStorage.getItem(LS_KEY); } catch (e) {}
    if (saved === 'fa' || saved === 'en') setLang(saved, false);

    initNav();
    initReveal();
    typewriter.start();

    /* Market data is a progressive enhancement. start it after first paint:
       idle callback where available, a short timer everywhere else. The
       session cache makes repeat visits fetch-free for the TTL window. */
    var kick = function () { loadAll(false); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(kick, { timeout: 1600 });
    else setTimeout(kick, 300);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
`;
