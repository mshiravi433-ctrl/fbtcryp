/**
 * Pure squarified treemap engine + capital-pulse analytics for Market Overview.
 *
 * Inspired by KirobotDev/Heatmap-Dashboard's size/heat/exclude-stablecoin model,
 * upgraded with a true Bruls–Huizing–van Wijk squarified treemap layout so tile
 * areas remain proportional to Market Cap (or 24h Volume) with near-square aspect
 * ratios at any viewport width.
 *
 * Zero network calls, zero DOM access, 100% deterministic.
 */

const STABLECOIN_ID_SET = new Set([
  'tether',
  'usd-coin',
  'dai',
  'first-digital-usd',
  'ethena-usde',
  'usds',
  'paypal-usd',
  'true-usd',
  'frax',
  'usdd',
  'paxos-standard',
  'gemini-dollar',
  'binance-usd',
  'ripple-usd',
  'usual-usd',
  'global-dollar',
  'eurc',
  'tether-eurt',
  'ondo-us-dollar-yield',
  'mountain-protocol-usdm'
]);

const STABLECOIN_SYMBOL_SET = new Set([
  'USDT',
  'USDC',
  'DAI',
  'FDUSD',
  'USDE',
  'USDS',
  'PYUSD',
  'TUSD',
  'FRAX',
  'USDD',
  'USDP',
  'GUSD',
  'BUSD',
  'RLUSD',
  'USD0',
  'USDG',
  'EURC',
  'USDY'
]);

export const HEATMAP_LIMITS = Object.freeze([12, 24, 50, 100]);
export const HEATMAP_WINDOWS = Object.freeze(['24h', '7d', '1h']);
export const HEATMAP_METRICS = Object.freeze(['mcap', 'volume']);

/** Power-law tempering exponent: keeps BTC dominant while rank #50 stays legible. */
const AREA_EXPONENT = 0.6;

export function isStablecoinCoin(coin) {
  if (!coin || typeof coin !== 'object') return false;
  const id = String(coin.id || '').trim().toLowerCase();
  if (STABLECOIN_ID_SET.has(id)) return true;
  const sym = String(coin.symbol || '').trim().toUpperCase();
  return STABLECOIN_SYMBOL_SET.has(sym);
}

export function changeForWindow(coin, window = '24h') {
  if (!coin || typeof coin !== 'object') return null;
  const raw =
    window === '1h'
      ? coin.change1h
      : window === '7d'
        ? coin.change7d
        : coin.change24h;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * 11-stop symmetric color band (`down-5` .. `flat` .. `up-5`) so small 0.4% drifts
 * look calm while 8%+ breakouts command immediate visual attention.
 */
export function heatToneForChange(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n) || Math.abs(n) < 0.03) return 'flat';
  if (n > 0) {
    if (n >= 8) return 'up-5';
    if (n >= 4) return 'up-4';
    if (n >= 1.5) return 'up-3';
    if (n >= 0.4) return 'up-2';
    return 'up-1';
  }
  const abs = Math.abs(n);
  if (abs >= 8) return 'down-5';
  if (abs >= 4) return 'down-4';
  if (abs >= 1.5) return 'down-3';
  if (abs >= 0.4) return 'down-2';
  return 'down-1';
}

function worstAspectRatio(rowAreas, sideLength) {
  if (!rowAreas.length || sideLength <= 0) return Infinity;
  let sum = 0;
  let minArea = Infinity;
  let maxArea = 0;
  for (const a of rowAreas) {
    sum += a;
    if (a < minArea) minArea = a;
    if (a > maxArea) maxArea = a;
  }
  if (sum <= 0 || minArea <= 0) return Infinity;
  const s2 = sum * sum;
  const w2 = sideLength * sideLength;
  return Math.max((w2 * maxArea) / s2, s2 / (w2 * minArea));
}

/**
 * Bruls–Huizing–van Wijk squarified treemap over `[0..width] x [0..height]`.
 *
 * @param {Array<{weight: number, [key: string]: any}>} entries
 * @param {number} [width=100]
 * @param {number} [height=100]
 * @returns {Array<object>} entries decorated with `{ x, y, w, h }` in `[0..width] x [0..height]`
 */
export function squarifyTreemap(entries, width = 100, height = 100) {
  const valid = (Array.isArray(entries) ? entries : [])
    .filter((e) => Number.isFinite(Number(e?.weight)) && Number(e.weight) > 0)
    .sort((a, b) => Number(b.weight) - Number(a.weight));

  const totalWeight = valid.reduce((sum, e) => sum + Number(e.weight), 0);
  if (!valid.length || totalWeight <= 0 || width <= 0 || height <= 0) return [];

  const totalArea = width * height;
  const scaled = valid.map((item) => ({
    item,
    area: (Number(item.weight) / totalWeight) * totalArea
  }));

  const out = [];
  let rx = 0;
  let ry = 0;
  let rw = width;
  let rh = height;

  let row = [];
  let idx = 0;

  const flushRow = (currentRow) => {
    const rowSum = currentRow.reduce((s, r) => s + r.area, 0);
    if (rowSum <= 0 || rw <= 0 || rh <= 0) return;
    const horizontal = rw < rh; // lay strip along the shorter side (`min(rw, rh)`)
    if (horizontal) {
      // Strip spans full width `rw`, thickness is `rowSum / rw`
      const stripH = rowSum / rw;
      let cx = rx;
      for (let i = 0; i < currentRow.length; i += 1) {
        const cell = currentRow[i];
        const cellW = i === currentRow.length - 1 ? rx + rw - cx : cell.area / stripH;
        out.push({
          ...cell.item,
          x: cx,
          y: ry,
          w: Math.max(0, cellW),
          h: Math.max(0, stripH)
        });
        cx += cellW;
      }
      ry += stripH;
      rh = Math.max(0, rh - stripH);
    } else {
      // Strip spans full height `rh`, thickness is `rowSum / rh`
      const stripW = rowSum / rh;
      let cy = ry;
      for (let i = 0; i < currentRow.length; i += 1) {
        const cell = currentRow[i];
        const cellH = i === currentRow.length - 1 ? ry + rh - cy : cell.area / stripW;
        out.push({
          ...cell.item,
          x: rx,
          y: cy,
          w: Math.max(0, stripW),
          h: Math.max(0, cellH)
        });
        cy += cellH;
      }
      rx += stripW;
      rw = Math.max(0, rw - stripW);
    }
  };

  while (idx < scaled.length) {
    const next = scaled[idx];
    const shortSide = Math.min(rw, rh);
    if (!row.length) {
      row.push(next);
      idx += 1;
      continue;
    }
    const curAreas = row.map((r) => r.area);
    const nextAreas = [...curAreas, next.area];
    if (worstAspectRatio(nextAreas, shortSide) <= worstAspectRatio(curAreas, shortSide)) {
      row.push(next);
      idx += 1;
    } else {
      flushRow(row);
      row = [];
    }
  }
  if (row.length) flushRow(row);

  return out.map((cell) => ({
    ...cell,
    xPct: (cell.x / width) * 100,
    yPct: (cell.y / height) * 100,
    wPct: (cell.w / width) * 100,
    hPct: (cell.h / height) * 100
  }));
}

function classifyTileTier(wPct, hPct) {
  const area = (wPct * hPct) / 100; // % of total canvas
  const minDim = Math.min(wPct, hPct);
  if (area >= 11 && minDim >= 22) return 'xl';
  if (area >= 5 && minDim >= 14) return 'lg';
  if (area >= 2.1 && minDim >= 9.5) return 'md';
  if (area >= 0.85 && minDim >= 6) return 'sm';
  return 'xs';
}

/**
 * Build the ready-to-render heatmap layout from live market rows.
 */
export function buildHeatmapLayout(
  coins = [],
  {
    limit = 24,
    metric = 'mcap',
    window = '24h',
    excludeStables = true,
    query = '',
    aspect = 1.6
  } = {}
) {
  const safeRows = Array.isArray(coins) ? coins : [];
  const q = String(query || '').trim().toLowerCase();

  const availableWindows = {};
  for (const w of HEATMAP_WINDOWS) {
    availableWindows[w] = safeRows.some((c) => {
      const val = changeForWindow(c, w);
      return val != null && val !== 0;
    });
  }
  const activeWindow = availableWindows[window] ? window : '24h';

  const filtered = safeRows.filter((c) => {
    if (!c || !c.id || !c.symbol) return false;
    if (excludeStables && isStablecoinCoin(c)) return false;
    if (q) {
      const sym = String(c.symbol || '').toLowerCase();
      const name = String(c.name || '').toLowerCase();
      if (!sym.includes(q) && !name.includes(q)) return false;
    }
    const mVal = metric === 'volume' ? Number(c.volume) : Number(c.mcap);
    return Number.isFinite(mVal) && mVal > 0;
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = metric === 'volume' ? Number(a.volume) : Number(a.mcap);
    const bv = metric === 'volume' ? Number(b.volume) : Number(b.mcap);
    return bv - av;
  });

  const cappedLimit = Math.max(4, Math.min(100, Number(limit) || 24));
  const sliced = sorted.slice(0, cappedLimit);
  const totalMetric = sliced.reduce(
    (sum, c) => sum + (metric === 'volume' ? Number(c.volume) : Number(c.mcap)),
    0
  );

  const weighted = sliced.map((coin) => {
    const rawMetric = metric === 'volume' ? Number(coin.volume) : Number(coin.mcap);
    const change = changeForWindow(coin, activeWindow);
    return {
      coin,
      rawMetric,
      sharePct: totalMetric > 0 ? (rawMetric / totalMetric) * 100 : 0,
      change,
      tone: heatToneForChange(change),
      weight: Math.pow(rawMetric, AREA_EXPONENT)
    };
  });

  const canvasW = Number.isFinite(aspect) && aspect > 0 ? 100 * aspect : 160;
  const laidOut = squarifyTreemap(weighted, canvasW, 100).map((tile) => ({
    ...tile,
    tier: classifyTileTier(tile.wPct, tile.hPct)
  }));

  return {
    tiles: laidOut,
    totalMetric,
    availableCount: filtered.length,
    shownCount: laidOut.length,
    activeWindow,
    availableWindows
  };
}

/**
 * Compute structural market breadth, median return, liquidity velocity, and
 * top movers / capital-flow leaders from the already-loaded market universe.
 */
export function computeCapitalPulse(coins = [], global = null) {
  const safeRows = Array.isArray(coins) ? coins : [];
  const activeCoins = safeRows.filter((c) => c && c.id && c.symbol && !isStablecoinCoin(c));

  const changes = [];
  let upCount = 0;
  let downCount = 0;
  let flatCount = 0;
  let sumMcap = 0;
  let sumVolume = 0;
  let mcapFlowAvailableCount = 0;
  let netMcapFlow24h = 0;

  for (const c of activeCoins) {
    const chg = Number(c.change24h);
    if (Number.isFinite(chg)) {
      changes.push(chg);
      if (chg > 0.05) upCount += 1;
      else if (chg < -0.05) downCount += 1;
      else flatCount += 1;
    }
    if (Number.isFinite(Number(c.mcap)) && Number(c.mcap) > 0) sumMcap += Number(c.mcap);
    if (Number.isFinite(Number(c.volume)) && Number(c.volume) > 0) sumVolume += Number(c.volume);
    if (c.mcapChange24h != null && Number.isFinite(Number(c.mcapChange24h)) && Number(c.mcapChange24h) !== 0) {
      mcapFlowAvailableCount += 1;
      netMcapFlow24h += Number(c.mcapChange24h);
    }
  }

  changes.sort((a, b) => a - b);
  const medianChange24h = changes.length
    ? changes.length % 2 === 1
      ? changes[(changes.length - 1) / 2]
      : (changes[changes.length / 2 - 1] + changes[changes.length / 2]) / 2
    : null;

  const directionalTotal = upCount + downCount;
  const breadthUpPct = directionalTotal > 0 ? (upCount / directionalTotal) * 100 : null;

  const btcDom = Number(global?.btcDominance);
  const ethDom = Number(global?.ethDominance);
  const altcoinSharePct =
    Number.isFinite(btcDom) && btcDom > 0 && Number.isFinite(ethDom) && ethDom >= 0 && btcDom + ethDom < 100
      ? Math.max(0, 100 - btcDom - ethDom)
      : null;

  const refMcap = Number(global?.mcap) > 0 ? Number(global.mcap) : sumMcap;
  const refVol = Number(global?.volume) > 0 ? Number(global.volume) : sumVolume;
  const turnoverPct = refMcap > 0 && refVol > 0 ? (refVol / refMcap) * 100 : null;

  const gainersRaw = activeCoins
    .filter((c) => Number.isFinite(Number(c.change24h)) && Number(c.change24h) > 0)
    .sort((a, b) => Number(b.change24h) - Number(a.change24h))
    .slice(0, 5);
  const maxGain = gainersRaw.length ? Math.max(0.01, Number(gainersRaw[0].change24h)) : 1;
  const gainers = gainersRaw.map((coin) => ({
    coin,
    value: Number(coin.change24h),
    barPct: Math.min(100, Math.max(10, (Number(coin.change24h) / maxGain) * 100))
  }));

  const losersRaw = activeCoins
    .filter((c) => Number.isFinite(Number(c.change24h)) && Number(c.change24h) < 0)
    .sort((a, b) => Number(a.change24h) - Number(b.change24h))
    .slice(0, 5);
  const maxLoss = losersRaw.length ? Math.max(0.01, Math.abs(Number(losersRaw[0].change24h))) : 1;
  const losers = losersRaw.map((coin) => ({
    coin,
    value: Number(coin.change24h),
    barPct: Math.min(100, Math.max(10, (Math.abs(Number(coin.change24h)) / maxLoss) * 100))
  }));

  const volumeRaw = activeCoins
    .filter((c) => Number.isFinite(Number(c.volume)) && Number(c.volume) > 0)
    .sort((a, b) => Number(b.volume) - Number(a.volume))
    .slice(0, 5);
  const maxVol = volumeRaw.length ? Math.max(1, Number(volumeRaw[0].volume)) : 1;
  const volumeLeaders = volumeRaw.map((coin) => ({
    coin,
    value: Number(coin.volume),
    mcapFlow: Number.isFinite(Number(coin.mcapChange24h)) ? Number(coin.mcapChange24h) : null,
    barPct: Math.min(100, Math.max(10, (Number(coin.volume) / maxVol) * 100))
  }));

  return {
    sampleSize: activeCoins.length,
    upCount,
    downCount,
    flatCount,
    breadthUpPct,
    medianChange24h,
    altcoinSharePct,
    turnoverPct,
    totalVolume: refVol > 0 ? refVol : null,
    netMcapFlow24h: mcapFlowAvailableCount >= 5 ? netMcapFlow24h : null,
    gainers,
    losers,
    volumeLeaders
  };
}
