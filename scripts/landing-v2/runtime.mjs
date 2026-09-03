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
    /* The dock's orb is the only control whose name changes with state, so it
       is re-labelled here rather than left English forever. */
    var LD = dict('dock');
    var orb = document.getElementById('dock-orb');
    if (orb && LD.open) {
      var openNow = dockIsOpen();
      orb.setAttribute('aria-label', openNow ? (LD.close || LD.open) : LD.open);
    }
    var dmenu = document.getElementById('dock-menu');
    if (dmenu && LD.label) dmenu.setAttribute('aria-label', LD.label);
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
    /*
     * An ARROW, not a percentage. The row the owner pointed at — the token
     * list next to the Intent OS panel — carried price AND «+2.31%», and at
     * 360px the pair did not fit inside the card: «قیمت و چند درصد افت یا رشد
     * کرده از صفحه زده بیرون. بجای درصد فقط فلش قرمز یا سبز».
     *
     * A direction glyph is 18px instead of 46px, it is readable at a glance in
     * both scripts (a «+» in RTL Persian is a known alignment trap), and the
     * exact number is still there — in the title, for anyone who wants the
     * magnitude instead of the sign.
     */
    var p = pct(v);
    var glyph = p.cls === 'up' ? '▲' : p.cls === 'down' ? '▼' : '▬';
    var s = el('span', 'chg-arrow ' + p.cls, glyph);
    s.setAttribute('title', p.text);
    s.setAttribute('aria-hidden', 'true');
    return s;
  }

  /** The same arrow for a plain-text slot (hero mockup rows). */
  function setArrow(node, v) {
    if (!node) return;
    var p = pct(v);
    node.textContent = p.cls === 'up' ? '▲' : p.cls === 'down' ? '▼' : '▬';
    node.className = 'chg-arrow ' + p.cls;
    node.setAttribute('title', p.text);
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
      if (coin && cNode) setArrow(cNode, coin.change24h);
    }
    var btc = null;
    for (var j = 0; j < DATA.markets.length; j++) if (DATA.markets[j].id === 'bitcoin') btc = DATA.markets[j];
    if (!btc) return;
    setText('#dp-price', price(btc.price));
    setArrow($('#dp-chg'), btc.change24h);
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

  /* ------------------------------------------------- AI token tape ------ */

  /**
   * The token tape under the Intent OS heading. It exists because the old
   * three-line stack of «price + ±x%» inside a narrow card is what was
   * overflowing; a tape has one row of fixed-height chips, each with the
   * logo, the symbol, the price and an arrow, and it scrolls instead of
   * breaking the layout.
   *
   * On a failed feed this is hidden rather than showing an error box: it is a
   * decoration above the real tables, and those already carry the honest
   * «Data unavailable» state with Retry. Two failure banners for one outage is
   * worse than one.
   */
  function renderAiTape() {
    var host = $('#ai-tape-track');
    if (!host) return;
    if (!Array.isArray(DATA.markets) || !DATA.markets.length) {
      var shell = $('#ai-tape');
      if (shell) shell.classList.add('is-off');
      return;
    }
    var shell2 = $('#ai-tape');
    if (shell2) shell2.classList.remove('is-off');
    clear(host);
    var list = DATA.markets.slice(0, 12);
    function chipFor(c) {
      var chip = el('span', 'tape-item');
      if (c.image) {
        var img = document.createElement('img');
        img.src = c.image; img.alt = ''; img.width = 18; img.height = 18;
        img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
        chip.appendChild(img);
      } else {
        chip.appendChild(el('i', 'tape-mono', String(c.symbol || '·').slice(0, 1)));
      }
      chip.appendChild(el('b', null, c.symbol || '—'));
      chip.appendChild(el('span', 'num', price(c.price)));
      chip.appendChild(changeCell(c.change24h));
      return chip;
    }
    /* Twice, so the CSS marquee loops without a visible seam. */
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < list.length; i++) host.appendChild(chipFor(list[i]));
    }
  }

  /**
   * The live chip on each slideshow slide. One number, from the feeds already
   * fetched — never a claim written into the copy.
   */
  function renderSlideLive() {
    var nodes = document.querySelectorAll('[data-live-kind]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var kind = node.getAttribute('data-live-kind');
      var row = null;
      if (kind === 'price') {
        var want = node.getAttribute('data-live-id');
        if (Array.isArray(DATA.markets)) {
          for (var j = 0; j < DATA.markets.length; j++) if (DATA.markets[j].id === want) row = DATA.markets[j];
        }
      } else if (kind === 'equity' || kind === 'commodity') {
        var arr = DATA.solana && Array.isArray(DATA.solana[kind === 'equity' ? 'equities' : 'commodities']) ? DATA.solana[kind === 'equity' ? 'equities' : 'commodities'] : [];
        arr = arr.slice().sort(function (a, b) { return (b.liquidity || 0) - (a.liquidity || 0); });
        if (arr.length) row = { symbol: arr[0].symbol, name: arr[0].name, price: arr[0].usdPrice, change24h: arr[0].change24h };
      } else if (kind === 'trending') {
        if (Array.isArray(DATA.trending) && DATA.trending.length) {
          row = { symbol: DATA.trending[0].symbol, name: DATA.trending[0].name, price: null, change24h: null };
        }
      }
      if (!row) { node.classList.add('is-off'); continue; }
      node.classList.remove('is-off');
      clear(node);
      node.appendChild(el('span', 'k', row.symbol || '—'));
      if (row.price != null) node.appendChild(el('span', 'v num', price(row.price)));
      if (row.change24h != null) node.appendChild(changeCell(row.change24h));
    }
  }

  /* ------------------------------------------------ orchestration ------- */

  var RENDERERS = [renderPulse, renderHeroMarket, renderTokens, renderStocks, renderFarms, renderSolana, renderMarketDash, renderOpportunities, renderHeroYield, renderAiTape, renderSlideLive];
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
    /* The header's burger is gone — the page menu lives in the bottom circle
       now (see initDock), which stays with the reader while scrolling. */
    var jump = $('.brand');
    if (jump) jump.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' }); });

    /* Which section am I in? The header link for it lights up, and so does the
       matching tile in the bottom dock — one observer, both menus. */
    if (typeof IntersectionObserver === 'undefined') return;
    var marks = document.querySelectorAll('[data-section-link]');
    if (!marks.length) return;
    var byId = {};
    for (var i = 0; i < marks.length; i++) {
      var key = marks[i].getAttribute('data-section-link');
      (byId[key] = byId[key] || []).push(marks[i]);
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        for (var k in byId) {
          if (!Object.prototype.hasOwnProperty.call(byId, k)) continue;
          for (var m = 0; m < byId[k].length; m++) byId[k][m].classList.toggle('is-active', k === e.target.id);
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(byId).forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec) io.observe(sec);
    });
  }

  /** Scroll reveal + the intent pipeline cascade. No-JS visitors are never
      affected: hiding only happens when this runtime marks html[data-js]. */
  /* How far through the Intent chain the reader has got: every step that has
 * lit adds a fraction, and the hairline above the grid draws to it. */
function flowProgress() {
  var all = document.querySelectorAll('.flow li');
  if (!all.length) return 0;
  var done = 0;
  for (var i = 0; i < all.length; i++) if (all[i].classList.contains('on')) done += 1;
  return done / all.length;
}
function updateFlowMeter() {
  var bars = document.querySelectorAll('.flow-meter i');
  if (!bars.length) return;
  var p = flowProgress();
  for (var i = 0; i < bars.length; i++) bars[i].style.setProperty('--p', p);
}

  /** Make one reveal node visible, lighting its flow steps too. */
  function revealNode(n) {
    n.classList.add('in');
    var lis = n.querySelectorAll('.flow li');
    for (var i = 0; i < lis.length; i++) lis[i].classList.add('on');
    updateFlowMeter();
  }

  function initReveal() {
    html.setAttribute('data-js', '1');
    /* Every hidden variant, not just .reveal — a reveal-zoom element that
       never carries the plain .reveal class would otherwise sit at
       opacity:0 for the whole session, leaving a black hole mid-page. */
    var REVEAL_SEL = '.reveal, .reveal-l, .reveal-r, .reveal-zoom';
    if (RM || typeof IntersectionObserver === 'undefined') {
      document.querySelectorAll(REVEAL_SEL).forEach(function (n) { n.classList.add('in'); });
      document.querySelectorAll('.flow li').forEach(function (n) { n.classList.add('on'); });
      updateFlowMeter();
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        revealNode(e.target);
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    var nodes = document.querySelectorAll(REVEAL_SEL);
    for (var i = 0; i < nodes.length; i++) io.observe(nodes[i]);

    /* The safety net.
     * IntersectionObserver callbacks are delivered as part of the frame the
     * intersection changed in; when the main thread is busy (lottie repaint,
     * image decode, a long scroll) a frame can be dropped and the callback
     * never comes — the element keeps opacity:0 forever. That is exactly the
     * "black page with nothing on it" the reader was scrolling past. A
     * viewport pass that measures with getBoundingClientRect on every scroll
     * tick cannot miss, and it tears itself down once every element has been
     * seen, so a finished page costs nothing. */
    var pending = [];
    for (var j = 0; j < nodes.length; j++) if (!nodes[j].classList.contains('in')) pending.push(nodes[j]);
    var netTimer = null;
    var queued = false;
    function pass() {
      if (!pending.length) return;
      var vh = window.innerHeight || document.documentElement.clientHeight || 800;
      var left = [];
      for (var k = 0; k < pending.length; k++) {
        var n = pending[k];
        if (n.classList.contains('in')) continue; /* IO already lit it */
        var r = n.getBoundingClientRect();
        if (r.bottom > -72 && r.top < vh + 72) revealNode(n);
        else left.push(n);
      }
      pending = left;
      if (!pending.length) {
        window.removeEventListener('scroll', netScroll);
        window.removeEventListener('resize', pass);
        if (netTimer) { clearInterval(netTimer); netTimer = null; }
      }
    }
    function netScroll() {
      if (queued) return;
      queued = true;
      if (window.requestAnimationFrame) requestAnimationFrame(function () { queued = false; pass(); });
      else { queued = false; pass(); }
    }
    window.addEventListener('scroll', netScroll, { passive: true });
    window.addEventListener('resize', pass);
    pass();
    /* The reader may stand still: while anything is pending, re-check at a
       relaxed cadence so a starved observer is still caught. Self-terminating. */
    netTimer = setInterval(pass, 600);
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

  /* ------------------------------------------------ the page dock ------- */

  /**
   * The circle at the bottom of the screen.
   *
   * It replaces the burger in the header (the request: «منو بازشونده را داخل
   * یک دایره پایین صفحه بزار … و با پایین و بالا رفتن در صفحه باشد»), and the
   * OPEN state is pure CSS — a checkbox plus :checked — so the menu is
   * reachable with JavaScript switched off or still blocked behind a slow
   * first paint on a 3G phone. What the script adds is only the polish:
   * closing after a pick, Escape, and the ring that shows how far down the
   * page you are.
   */
  function dockIsOpen() {
    var st = document.getElementById('dock-state');
    return !!(st && st.checked);
  }

  function initDock() {
    var dock = $('#page-dock');
    if (!dock) return;
    var state = $('#dock-state');
    var orb = $('#dock-orb');

    function sync() {
      var open = !!(state && state.checked);
      dock.classList.toggle('is-open', open);
      if (orb) {
        orb.setAttribute('aria-expanded', String(open));
        var LD = dict('dock');
        if (LD.open) orb.setAttribute('aria-label', open ? (LD.close || LD.open) : LD.open);
      }
    }
    if (state) state.addEventListener('change', sync);
    sync();

    dock.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('a') : null;
      var scrim = ev.target && ev.target.closest ? ev.target.closest('[data-dock-scrim]') : null;
      if ((!a && !scrim) || !state) return;
      state.checked = false;
      sync();
    });
    /* Space or Enter on the label: the checkbox gets the click and the CSS
       does the rest, but the label also carries role=button, so make sure a
       key press on it toggles exactly once. */
    if (orb) {
      orb.addEventListener('keydown', function (ev) {
        if (ev.key !== ' ' && ev.key !== 'Enter') return;
        ev.preventDefault();
        if (state) { state.checked = !state.checked; sync(); }
      });
    }
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' || !state || !state.checked) return;
      state.checked = false;
      sync();
      if (orb) orb.focus();
    });

    /* Scroll: the ring + a small tuck so it never covers content, and it
       grows back the moment the reader scrolls up. It is never removed. */
    var ring = $('#dock-ring-fill');
    var queued = false;
    var lastY = window.scrollY || 0;
    function paint() {
      queued = false;
      var doc = document.documentElement;
      var max = Math.max(1, doc.scrollHeight - window.innerHeight);
      var y = Math.max(0, Math.min(1, (window.scrollY || 0) / max));
      if (ring) ring.setAttribute('style', 'transform:rotate(' + (y * 360).toFixed(1) + 'deg)');
      dock.style.setProperty('--sp', y.toFixed(3));
      var down = (window.scrollY || 0) > lastY + 4;
      var up = (window.scrollY || 0) < lastY - 4;
      if (down && (window.scrollY || 0) > 200) dock.classList.add('is-tucked');
      if (up) dock.classList.remove('is-tucked');
      if ((window.scrollY || 0) < 60) dock.classList.remove('is-tucked');
      lastY = window.scrollY || 0;
    }
    window.addEventListener('scroll', function () {
      if (queued) return;
      queued = true;
      if (window.requestAnimationFrame) requestAnimationFrame(paint);
      else setTimeout(paint, 90);
    }, { passive: true });
    paint();
  }

  /* ------------------------------------------------ product slideshow --- */

  /**
   * The bilingual product tour: five slides, autoplay, swipe, dots
   * (the left/right arrows were removed — they overlapped the slide copy).
   *
   * The autoplay pauses on hover, on focus inside, on a hidden tab and on
   * reduced motion — a carousel that moves while someone is reading the
   * sentence on it is a bug, not a feature. The progress bar is the autoplay
   * timer made visible, which is also what tells the reader the next slide is
   * coming and when.
   */
  function initShowcase() {
    var show = $('#show');
    if (!show) return;
    var slides = [].slice.call(show.querySelectorAll('.show-slide'));
    var dots = [].slice.call(show.querySelectorAll('[data-dot]'));
    var bar = $('#show-bar');
    var playBtn = $('[data-show-play]');
    if (!slides.length) return;
    var idx = 0;
    var prog = 0;
    var lastTs = 0;
    var rafId = null;
    var onScreen = false;
    var paused = false;
    var AUTOPLAY = 6800;

    function playing() { return !paused && !RM; }
    function setPlaying(on) {
      paused = !on;
      show.classList.toggle('is-paused', paused);
      if (playBtn) playBtn.setAttribute('aria-pressed', String(!paused));
    }
    /** A viewer is on the slide: hover, keyboard focus inside, or a hidden tab. */
    function blocked() {
      return document.hidden || show.classList.contains('is-hover') || show.classList.contains('is-focus') || RM || !onScreen;
    }

    function go(n, fromUser) {
      idx = (n + slides.length) % slides.length;
      for (var i = 0; i < slides.length; i++) {
        var on = i === idx;
        slides[i].classList.toggle('is-on', on);
        slides[i].setAttribute('aria-hidden', String(!on));
      }
      for (var d = 0; d < dots.length; d++) {
        dots[d].setAttribute('aria-selected', String(d === idx));
        dots[d].classList.toggle('on', d === idx);
      }
      show.setAttribute('data-accent', slides[idx].getAttribute('data-accent') || '');
      prog = 0;
      if (fromUser && !paused) setPlaying(true);
      start();
    }

    function loop() {
      var now = Date.now();
      var dt = lastTs ? Math.min(64, now - lastTs) : 16;
      lastTs = now;
      if (playing() && !blocked()) {
        prog += dt / AUTOPLAY;
        if (prog >= 1) { prog = 0; go(idx + 1, false); }
      }
      if (bar) bar.style.setProperty('--p', Math.max(0, Math.min(1, prog)).toFixed(3));
      rafId = requestAnimationFrame(loop);
    }
    function start() {
      if (rafId != null || RM || !slides.length) { if (bar) bar.style.setProperty('--p', '1'); return; }
      lastTs = 0;
      rafId = requestAnimationFrame(loop);
    }
    function stop() {
      if (rafId == null) return;
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    show.addEventListener('mouseenter', function () { show.classList.add('is-hover'); });
    show.addEventListener('mouseleave', function () { show.classList.remove('is-hover'); });
    show.addEventListener('focusin', function () { show.classList.add('is-focus'); });
    show.addEventListener('focusout', function (ev) {
      if (!show.contains(ev.relatedTarget)) show.classList.remove('is-focus');
    });

    for (var d2 = 0; d2 < dots.length; d2++) {
      (function (n) {
        dots[n].addEventListener('click', function () { go(n, true); });
      })(d2);
    }
    if (playBtn) playBtn.addEventListener('click', function () { setPlaying(paused); });

    /* Keyboard, when focus is anywhere inside the tour. RTL flips the arrow
       meaning, because in Persian the timeline runs the other way. */
    show.addEventListener('keydown', function (ev) {
      var rtl = document.documentElement.dir === 'rtl';
      if (ev.key === 'ArrowRight') { ev.preventDefault(); go(rtl ? idx - 1 : idx + 1, true); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); go(rtl ? idx + 1 : idx - 1, true); }
    });

    /* Swipe. Pointer events so a mouse-drag works too, and the drag itself
       drags the slide — a 40px nudge is what makes it feel grabbable. */
    var stage = $('#show-stage');
    if (stage) {
      var px = null, py = null;
      stage.addEventListener('pointerdown', function (ev) {
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;
        px = ev.clientX; py = ev.clientY;
        stage.classList.add('is-drag');
      });
      stage.addEventListener('pointermove', function (ev) {
        if (px == null) return;
        var dx = ev.clientX - px;
        stage.style.setProperty('--drag', Math.max(-90, Math.min(90, dx * 0.22)).toFixed(1) + 'px');
      });
      var endDrag = function (ev) {
        if (px == null) return;
        var dx = ev.clientX - px;
        var dy = ev.clientY - (py == null ? ev.clientY : py);
        px = null; py = null;
        stage.classList.remove('is-drag');
        stage.style.setProperty('--drag', '0px');
        if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy)) return;
        var rtl2 = document.documentElement.dir === 'rtl';
        go(dx < 0 ? (rtl2 ? idx - 1 : idx + 1) : (rtl2 ? idx + 1 : idx - 1), true);
      };
      stage.addEventListener('pointerup', endDrag);
      stage.addEventListener('pointercancel', endDrag);
    }

    /* Only animate the part of the loop the reader can see. */
    if (typeof IntersectionObserver !== 'undefined') {
      new IntersectionObserver(function (entries) {
        onScreen = !!(entries[0] && entries[0].isIntersecting);
        if (onScreen) start(); else stop();
      }, { threshold: 0.15 }).observe(show);
    } else {
      onScreen = true;
    }

    go(0, false);
    if (RM) { setPlaying(false); if (bar) bar.style.setProperty('--p', '1'); }
    else start();
  }

  /* ------------------------------------------------------ motion fx ----- */

  /**
   * Two small pointer effects: a spotlight that follows the cursor across a
   * card, and a 3-degree tilt on the media-heavy ones. Both write CSS custom
   * properties and let the compositor do the rest, both are skipped under
   * reduced motion, and both are one listener on the grid rather than one per
   * card.
   */
  function initFx() {
    if (RM) return;
    var targets = document.querySelectorAll('.card, .net-card, .pulse-card, .stat-card, .say-card');
    var cur = null;
    var queued = false;
    function spot(ev) {
      if (!cur) return;
      var r = cur.getBoundingClientRect();
      cur.style.setProperty('--mx', ((ev.clientX - r.left) / Math.max(1, r.width) * 100).toFixed(1) + '%');
      cur.style.setProperty('--my', ((ev.clientY - r.top) / Math.max(1, r.height) * 100).toFixed(1) + '%');
    }
    document.addEventListener('pointermove', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('.card, .net-card, .pulse-card, .stat-card, .say-card') : null;
      if (t !== cur) {
        if (cur) { cur.classList.remove('is-lit'); cur.style.removeProperty('--mx'); cur.style.removeProperty('--my'); }
        cur = t;
        if (cur) cur.classList.add('is-lit');
      }
      if (!cur || queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; spot(ev); });
    }, { passive: true });

    /* Hero mockup and slide art drift a few pixels against the pointer. */
    var par = document.querySelectorAll('[data-parallax]');
    if (par.length) {
      document.addEventListener('pointermove', function (ev) {
        var mx = ev.clientX / window.innerWidth - 0.5;
        var my = ev.clientY / window.innerHeight - 0.5;
        for (var i = 0; i < par.length; i++) {
          var depth = Number(par[i].getAttribute('data-parallax')) || 8;
          par[i].style.setProperty('--px', (mx * depth).toFixed(2) + 'px');
          par[i].style.setProperty('--py', (my * depth).toFixed(2) + 'px');
        }
      }, { passive: true });
    }

    /* Scroll depth on the ambient lines: one transform per frame, on one node. */
    var lines = $('#bg-lines');
    if (lines) {
      var lock = false;
      window.addEventListener('scroll', function () {
        if (lock) return;
        lock = true;
        requestAnimationFrame(function () {
          lock = false;
          lines.style.setProperty('--shift', ((window.scrollY || 0) * 0.04).toFixed(2) + 's');
        });
      }, { passive: true });
    }
  }

  /* ------------------------------------------------ lottie mini player -- */

  /*
   * The animations on this page are real Lottie files (Bodymovin v5 layer /
   * keyframe schema) authored in scripts/landing-v2/lottie.mjs and inlined into
   * the document once. This is the player: about a hundred lines that cover
   * exactly the subset those files use — transform keyframes (position, scale,
   * rotation, opacity), ellipse / rect / bezier path, one fill and one stroke
   * per group, and trim paths. Anything else in a file is skipped rather than
   * thrown at, so a future animation that reaches past the subset loses an
   * effect instead of breaking the page.
   *
   * Choosing this over lottie-web (~100 KB) is a speed call with a real
   * tradeoff: the subset is smaller, but the whole page keeps its
   * one-inline-script structure, costs no second request, and works inside the
   * APK where a CDN copy would not.
   *
   * Cost control: a shared rAF drives only the animations currently on screen,
   * the loop stops when the tab is hidden, and reduced-motion renders frame 0
   * and never starts the loop.
   */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function bezAt(t, a, b) {
    var mt = 1 - t;
    return 3 * mt * mt * t * a + 3 * mt * t * t * b + t * t * t;
  }
  function kfNum(obj, key, fallback) {
    if (!obj) return fallback;
    var raw = obj[key];
    if (raw == null) return fallback;
    return typeof raw === 'number' ? raw : (Array.isArray(raw) && typeof raw[0] === 'number' ? raw[0] : fallback);
  }
  /** Lottie easing: out.x/out.y on the start keyframe, in.x/in.y on it too. */
  function easeFor(kf) {
    if (kf._ez) return kf._ez;
    var x1 = kfNum(kf.o, 'x', 0.42), y1 = kfNum(kf.o, 'y', 0);
    var x2 = kfNum(kf.i, 'x', 0.58), y2 = kfNum(kf.i, 'y', 1);
    var linear = x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1;
    var fn = linear ? function (u) { return u; } : function (u) {
      if (u <= 0) return 0;
      if (u >= 1) return 1;
      var lo = 0, hi = 1, mid = u;
      for (var i = 0; i < 14; i++) {
        mid = (lo + hi) / 2;
        if (bezAt(mid, x1, x2) < u) lo = mid; else hi = mid;
      }
      return bezAt(mid, y1, y2);
    };
    kf._ez = fn;
    return fn;
  }

  /** Evaluate a Lottie property at 'frame' into 'out' (a 3-slot array). */
  function pv(prop, frame, out) {
    out[0] = 0; out[1] = 0; out[2] = 0;
    if (!prop) return out;
    var k = prop.k;
    function put(v) {
      if (typeof v === 'number') { out[0] = v; return; }
      if (Array.isArray(v)) { for (var i = 0; i < 3; i++) out[i] = typeof v[i] === 'number' ? v[i] : (v[0] || 0); }
    }
    if (prop.a !== 1 || !Array.isArray(k)) { put(k); return out; }
    if (!k.length) return out;
    if (frame <= k[0].t) { put(k[0].s); return out; }
    var lastK = k[k.length - 1];
    if (frame >= lastK.t) { put(lastK.s); return out; }
    var i2 = 0;
    while (i2 < k.length - 2 && frame >= k[i2 + 1].t) i2++;
    var a = k[i2], b = k[i2 + 1];
    var span = b.t - a.t || 1;
    var u = easeFor(a)((frame - a.t) / span);
    var from = a.s, to = a.e != null ? a.e : b.s;
    if (typeof from === 'number' || typeof to === 'number') {
      var f0 = typeof from === 'number' ? from : from[0];
      var t0 = typeof to === 'number' ? to : to[0];
      out[0] = f0 + (t0 - f0) * u;
      return out;
    }
    for (var n = 0; n < 3; n++) {
      var fv = typeof from[n] === 'number' ? from[n] : 0;
      var tv = typeof to[n] === 'number' ? to[n] : fv;
      out[n] = fv + (tv - fv) * u;
    }
    return out;
  }

  function rgbOf(color) {
    var c = color && color.k ? color.k : [1, 1, 1, 1];
    var r = Math.round((c[0] || 0) * 255), g = Math.round((c[1] || 0) * 255), b = Math.round((c[2] || 0) * 255);
    var a = c.length > 3 ? c[3] : 1;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (a == null ? 1 : a) + ')';
  }

  function elPath(cx, cy, rx, ry) {
    var k = 0.5523, ox = rx * k, oy = ry * k;
    return 'M' + (cx - rx) + ' ' + cy +
      'C' + (cx - rx) + ' ' + (cy - oy) + ' ' + (cx - ox) + ' ' + (cy - ry) + ' ' + cx + ' ' + (cy - ry) +
      'C' + (cx + ox) + ' ' + (cy - ry) + ' ' + (cx + rx) + ' ' + (cy - oy) + ' ' + (cx + rx) + ' ' + cy +
      'C' + (cx + rx) + ' ' + (cy + oy) + ' ' + (cx + ox) + ' ' + (cy + ry) + ' ' + cx + ' ' + (cy + ry) +
      'C' + (cx - ox) + ' ' + (cy + ry) + ' ' + (cx - rx) + ' ' + (cy + oy) + ' ' + (cx - rx) + ' ' + cy + 'Z';
  }
  function rcPath(cx, cy, w, h, r) {
    var hw = w / 2, hh = h / 2;
    var rr = Math.max(0, Math.min(r || 0, Math.min(hw, hh)));
    var x = cx - hw, y = cy - hh;
    if (!rr) return 'M' + x + ' ' + y + 'H' + (x + w) + 'V' + (y + h) + 'H' + x + 'Z';
    return 'M' + (x + rr) + ' ' + y + 'H' + (x + w - rr) + 'A' + rr + ' ' + rr + ' 0 0 1 ' + (x + w) + ' ' + (y + rr) +
      'V' + (y + h - rr) + 'A' + rr + ' ' + rr + ' 0 0 1 ' + (x + w - rr) + ' ' + (y + h) +
      'H' + (x + rr) + 'A' + rr + ' ' + rr + ' 0 0 1 ' + x + ' ' + (y + h - rr) +
      'V' + (y + rr) + 'A' + rr + ' ' + rr + ' 0 0 1 ' + (x + rr) + ' ' + y + 'Z';
  }
  function shPath(shape) {
    var ks = shape.ks && shape.ks.k ? shape.ks.k : null;
    if (!ks || !ks.v || ks.v.length < 2) return '';
    var v = ks.v, o = ks.o || [], ii = ks.i || [], n = v.length;
    var d = 'M' + v[0][0] + ' ' + v[0][1];
    var segs = ks.c ? n : n - 1;
    for (var i = 0; i < segs; i++) {
      var a = v[i], b = v[(i + 1) % n];
      var oa = o[i] || [0, 0], ib = ii[(i + 1) % n] || [0, 0];
      d += 'C' + (a[0] + oa[0]) + ' ' + (a[1] + oa[1]) + ' ' + (b[0] + ib[0]) + ' ' + (b[1] + ib[1]) + ' ' + b[0] + ' ' + b[1];
    }
    if (ks.c) d += 'Z';
    return d;
  }

  function buildLottie(host, def) {
    if (!def || !Array.isArray(def.layers) || !def.layers.length) return null;
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + (def.w || 200) + ' ' + (def.h || 200));
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('class', 'lot');
    svg.setAttribute('aria-hidden', 'true');
    var updaters = [];
    var A = [0, 0, 0];
    var tmp = [0, 0, 0];

    function transformAttr(tr, frame) {
      pv(tr.p, frame, A);
      var x = A[0], y = A[1];
      pv(tr.a, frame, tmp);
      var ax = tmp[0], ay = tmp[1];
      pv(tr.s, frame, A);
      var sx = A[0] / 100, sy = A[1] / 100;
      pv(tr.r, frame, tmp);
      var rot = tmp[0];
      var s = 'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ')';
      if (rot) s += ' rotate(' + rot.toFixed(2) + ')';
      if (sx !== 1 || sy !== 1) s += ' scale(' + sx.toFixed(4) + ' ' + sy.toFixed(4) + ')';
      if (ax || ay) s += ' translate(' + (-ax).toFixed(2) + ' ' + (-ay).toFixed(2) + ')';
      return s;
    }
    function opOf(node, frame) {
      pv(node, frame, A);
      return Math.max(0, Math.min(1, A[0] / 100));
    }

    function buildGroup(items, parent) {
      var g = document.createElementNS(SVG_NS, 'g');
      parent.appendChild(g);
      var geoms = [], fills = [], strokes = [], tr = null, tm = null;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.ty) continue;
        if (it.ty === 'gr') { buildGroup(it.it || [], g); continue; }
        if (it.ty === 'tr') { tr = it; continue; }
        if (it.ty === 'tm') { tm = it; continue; }
        if (it.ty === 'fl') { fills.push(it); continue; }
        if (it.ty === 'st') { strokes.push(it); continue; }
        if (it.ty === 'el' || it.ty === 'rc' || it.ty === 'sh') geoms.push(it);
      }
      var paths = [];
      for (var n = 0; n < geoms.length; n++) {
        var gm = geoms[n];
        var d = '';
        if (gm.ty === 'el') d = elPath(gm.p ? gm.p.k[0] : 0, gm.p ? gm.p.k[1] : 0, gm.s.k[0] / 2, gm.s.k[1] / 2);
        else if (gm.ty === 'rc') d = rcPath(gm.p ? gm.p.k[0] : 0, gm.p ? gm.p.k[1] : 0, gm.s.k[0], gm.s.k[1], gm.r ? gm.r.k : 0);
        else d = shPath(gm);
        if (!d) continue;
        var p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', d);
        var f = fills[0], s = strokes[0];
        p.setAttribute('fill', f ? rgbOf(f.c) : 'none');
        p.setAttribute('stroke', s ? rgbOf(s.c) : 'none');
        if (s) {
          p.setAttribute('stroke-width', String(s.w && s.w.k ? s.w.k[0] : 2));
          p.setAttribute('stroke-linecap', 'round');
          p.setAttribute('stroke-linejoin', 'round');
        }
        if (tm) p.setAttribute('pathLength', '100');
        g.appendChild(p);
        paths.push({ node: p, stroke: s, fill: f });
      }
      updaters.push(function (frame) {
        if (tr) { g.setAttribute('transform', transformAttr(tr, frame)); g.setAttribute('opacity', opOf(tr.o, frame).toFixed(3)); }
        for (var n2 = 0; n2 < paths.length; n2++) {
          var rec = paths[n2];
          if (rec.fill) rec.node.setAttribute('fill', rgbOf(rec.fill.c));
          if (!rec.stroke) continue;
          if (!tm) continue;
          pv(tm.s, frame, A);
          pv(tm.e, frame, tmp);
          var s0 = A[0], e0 = tmp[0];
          pv(tm.o, frame, A);
          var shift = (A[0] / 3.6);
          var st = ((s0 + shift) % 100 + 100) % 100;
          var en = ((e0 + shift) % 100 + 100) % 100;
          var len = st <= en ? en - st : (100 - st) + en;
          rec.node.setAttribute('stroke-dasharray', len.toFixed(2) + ' ' + (100 - len).toFixed(2));
          rec.node.setAttribute('stroke-dashoffset', (-st).toFixed(2));
        }
      });
      return g;
    }

    /* Lottie paints the first layer last (it is the topmost in After
       Effects), so append in reverse index order. */
    var order = def.layers.slice().sort(function (a, b) { return (b.ind || 0) - (a.ind || 0); });
    for (var L = 0; L < order.length; L++) {
      var layer = order[L];
      if (layer.ty !== 4) continue;
      var wrap = document.createElementNS(SVG_NS, 'g');
      svg.appendChild(wrap);
      var items = [];
      for (var q = 0; q < (layer.shapes || []).length; q++) items.push(layer.shapes[q]);
      for (var z = 0; z < items.length; z++) {
        var it2 = items[z];
        if (it2.ty === 'gr') buildGroup(it2.it || [], wrap);
        else buildGroup([it2], wrap);
      }
      (function (node, ks, ip, op) {
        updaters.push(function (frame) {
          var vis = frame >= (ip || 0) && frame < (op || 99999);
          node.setAttribute('display', vis ? 'inline' : 'none');
          if (!vis) return;
          node.setAttribute('transform', transformAttr({ p: ks.p, a: ks.a, s: ks.s, r: ks.r, o: ks.o }, frame));
        });
      })(wrap, layer.ks || {}, layer.ip, layer.op);
    }

    host.textContent = '';
    host.appendChild(svg);
    return {
      ip: def.ip || 0,
      render: function (frame) {
        for (var i = 0; i < updaters.length; i++) updaters[i](frame);
      },
      fr: def.fr || 30,
      op: def.op || 90
    };
  }

  /** One shared loop for every animation on screen. */
  var LOT = { items: [], running: false, t0: 0, lastPaint: 0 };
  function lotFrame(now) {
    if (!LOT.running) return;
    var any = false;
    for (var i = 0; i < LOT.items.length; i++) {
      var it = LOT.items[i];
      if (!it.visible) continue;
      any = true;
      var f = it.inst.ip + (((now - LOT.t0) / 1000) * it.inst.fr);
      it.inst.render(((f % it.inst.op) + it.inst.op) % it.inst.op);
    }
    if (any && !document.hidden) requestAnimationFrame(lotFrame);
    else { LOT.running = false; if (!document.hidden) lotMaybeStart(); }
  }
  function lotMaybeStart() {
    if (LOT.running || RM) return;
    var need = false;
    for (var i = 0; i < LOT.items.length; i++) if (LOT.items[i].visible) { need = true; break; }
    if (!need || document.hidden) return;
    LOT.running = true;
    LOT.t0 = performance.now ? performance.now() : Date.now();
    requestAnimationFrame(lotFrame);
  }

  function initLottie() {
    var data = null;
    var holder = document.getElementById('lottie-data');
    if (!holder) return;
    try { data = JSON.parse(holder.textContent); } catch (e) { return; }
    if (!data) return;
    var hosts = document.querySelectorAll('[data-lottie]');
    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i];
      var def = data[host.getAttribute('data-lottie')];
      if (!def) continue;
      var inst = null;
      try { inst = buildLottie(host, def); } catch (e2) { inst = null; }
      if (!inst) { host.classList.add('lot-off'); continue; }
      LOT.items.push({ host: host, inst: inst, visible: false });
    }
    if (!LOT.items.length) return;

    if (typeof IntersectionObserver === 'undefined') {
      for (var k = 0; k < LOT.items.length; k++) LOT.items[k].visible = true;
      for (var m = 0; m < LOT.items.length; m++) LOT.items[m].inst.render(0);
      if (RM) return;
      lotMaybeStart();
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      for (var n = 0; n < entries.length; n++) {
        var rec = entries[n].target.__lot;
        if (!rec) continue;
        rec.visible = entries[n].isIntersecting;
      }
      if (RM) for (var r = 0; r < LOT.items.length; r++) if (LOT.items[r].visible) LOT.items[r].inst.render(0);
      else lotMaybeStart();
    }, { rootMargin: '80px 0px', threshold: 0.01 });
    for (var j = 0; j < LOT.items.length; j++) {
      LOT.items[j].host.__lot = LOT.items[j];
      io.observe(LOT.items[j].host);
    }

    if (RM) { for (var s2 = 0; s2 < LOT.items.length; s2++) LOT.items[s2].inst.render(0); return; }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) lotMaybeStart(); });
    lotMaybeStart();
  }

  /* ------------------------------------------------ live refresh -------- */

  /*
   * The numbers on this page are quotes, not screenshots. One silent refetch
   * every 90 seconds, and only while the tab is in front of the reader: the
   * same TTL the session cache already uses, so a background tab costs the
   * shared CoinGecko budget nothing.
   */
  /*
 * A count-up is only honest if the number it lands on is the number that was
 * already there, so this animates FROM zero TO the value the page shipped with
 * and writes that exact string at the end — it never invents an intermediate
 * truth for a screen reader (the node is aria-hidden while it runs) and it
 * leaves anything containing a link alone. Reduced motion skips it entirely.
 */
function initCounts() {
  if (!('IntersectionObserver' in window) || prefersReduced()) return;
  const nodes = $$('.hero-stat b, .stat-strip b').filter((n) => !n.firstElementChild);
  if (!nodes.length) return;
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const node = entry.target;
      io.unobserve(node);
      const text = node.textContent.trim();
      const m = text.match(/^(\D*?)(\d+(?:\.\d+)?)(.*)$/);
      if (!m) continue;
      const target = parseFloat(m[2]);
      const decimals = (m[2].split('.')[1] || '').length;
      const startedAt = performance.now();
      node.setAttribute('aria-hidden', 'true');
      const step = (now) => {
        const k = Math.min(1, (now - startedAt) / 700);
        const eased = 1 - Math.pow(1 - k, 3);
        node.textContent = m[1] + (target * eased).toFixed(decimals) + m[3];
        if (k < 1) requestAnimationFrame(step);
        else { node.textContent = text; node.removeAttribute('aria-hidden'); }
      };
      requestAnimationFrame(step);
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.3 });
  for (const n of nodes) io.observe(n);
}

function initRefresh() {
    var PERIOD = 90000;
    setInterval(function () {
      if (document.hidden) return;
      loadAll(true);
    }, PERIOD);
  }



  function boot() {
    /* Saved language wins over the English default — same rule the
       pre-paint script applied, repeated here so button state matches. */
    var saved = null;
    try { saved = localStorage.getItem(LS_KEY); } catch (e) {}
    if (saved === 'fa' || saved === 'en') setLang(saved, false);

    initNav();
    initReveal();
    initDock();
    initShowcase();
    initLottie();
    initFx();
    typewriter.start();

    /* Market data is a progressive enhancement. start it after first paint:
       idle callback where available, a short timer everywhere else. The
       session cache makes repeat visits fetch-free for the TTL window. */
    var kick = function () { loadAll(false); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(kick, { timeout: 1600 });
    else setTimeout(kick, 300);
    initRefresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
`;
