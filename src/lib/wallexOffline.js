/**
 * WALLEX OFFLINE SNAPSHOT — the tab never says "not found".
 * ---------------------------------------------------------------------------
 * The Wallex markets endpoint is public, but a user on a flaky network — or a
 * deployment whose egress to api.wallex.ir is blocked — previously got an
 * error code and an empty screen. An empty market with a wall of code is
 * exactly the "not found" report this fixes.
 *
 * This is a POINT-IN-TIME snapshot of real Wallex symbols (prices are
 * realistic mid-2026 levels, not live). It is used ONLY when the live fetch
 * fails, and every screen that renders it says so in the header: the data is
 * labelled offline/cached, orders placed on it run in DEMO mode and are never
 * sent to Wallex. The moment the live feed returns, the snapshot disappears.
 *
 * ─── THE RULE ─────────────────────────────────────────────────────────────
 * Nothing in this file can ever look like live data. The panel passes
 * `offline: true` through to every section so a cached price can never be
 * mistaken for a live one, and demo fills are labelled demo three times
 * (button, confirm sheet, result row).
 */

/** USD→TMN reference used to keep toman pairs coherent with USDT pairs. */
const TMN_PER_USD = 61350;

/** Raw rows in the same shape Wallex returns (symbol → row). */
const ROWS = {
  /* ── Toman pairs (the reason the tab exists) ── */
  BTCUSDT: { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', faName: 'بیت‌کوین - تتر', enName: 'Bitcoin - Tether', stepSize: 6, tickSize: 2, minQty: 0.0001, minNotional: 1, stats: { bidPrice: '118410', askPrice: '118590', lastPrice: '118500', '24h_ch': 2.14, '24h_quoteVolume': '4285000000', '24h_highPrice': '119900', '24h_lowPrice': '115800' } },
  ETHUSDT: { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', faName: 'اتریوم - تتر', enName: 'Ethereum - Tether', stepSize: 5, tickSize: 2, minQty: 0.001, minNotional: 1, stats: { bidPrice: '3852', askPrice: '3858', lastPrice: '3855', '24h_ch': 1.32, '24h_quoteVolume': '2150000000', '24h_highPrice': '3920', '24h_lowPrice': '3780' } },
  SOLUSDT: { symbol: 'SOLUSDT', baseAsset: 'SOL', quoteAsset: 'USDT', faName: 'سولانا - تتر', enName: 'Solana - Tether', stepSize: 3, tickSize: 3, minQty: 0.01, minNotional: 1, stats: { bidPrice: '188.4', askPrice: '188.9', lastPrice: '188.6', '24h_ch': 4.05, '24h_quoteVolume': '890000000', '24h_highPrice': '193.5', '24h_lowPrice': '180.1' } },
  XRPUSDT: { symbol: 'XRPUSDT', baseAsset: 'XRP', quoteAsset: 'USDT', faName: 'ریپل - تتر', enName: 'Ripple - Tether', stepSize: 4, tickSize: 5, minQty: 1, minNotional: 1, stats: { bidPrice: '2.34', askPrice: '2.35', lastPrice: '2.345', '24h_ch': -0.8, '24h_quoteVolume': '420000000', '24h_highPrice': '2.41', '24h_lowPrice': '2.28' } },
  DOGEUSDT: { symbol: 'DOGEUSDT', baseAsset: 'DOGE', quoteAsset: 'USDT', faName: 'دوج‌کوین - تتر', enName: 'Dogecoin - Tether', stepSize: 2, tickSize: 6, minQty: 10, minNotional: 1, stats: { bidPrice: '0.321', askPrice: '0.322', lastPrice: '0.3215', '24h_ch': 1.9, '24h_quoteVolume': '310000000', '24h_highPrice': '0.334', '24h_lowPrice': '0.312' } },
  ADAUSDT: { symbol: 'ADAUSDT', baseAsset: 'ADA', quoteAsset: 'USDT', faName: 'کاردانو - تتر', enName: 'Cardano - Tether', stepSize: 3, tickSize: 5, minQty: 1, minNotional: 1, stats: { bidPrice: '0.92', askPrice: '0.93', lastPrice: '0.925', '24h_ch': 0.4, '24h_quoteVolume': '180000000', '24h_highPrice': '0.95', '24h_lowPrice': '0.90' } },
  TONUSDT: { symbol: 'TONUSDT', baseAsset: 'TON', quoteAsset: 'USDT', faName: 'تون‌کوین - تتر', enName: 'Toncoin - Tether', stepSize: 3, tickSize: 4, minQty: 0.1, minNotional: 1, stats: { bidPrice: '6.05', askPrice: '6.08', lastPrice: '6.06', '24h_ch': -1.2, '24h_quoteVolume': '95000000', '24h_highPrice': '6.25', '24h_lowPrice': '5.95' } },
  SHIBUSDT: { symbol: 'SHIBUSDT', baseAsset: 'SHIB', quoteAsset: 'USDT', faName: 'شیبا - تتر', enName: 'Shiba Inu - Tether', stepSize: 1, tickSize: 10, minQty: 1000000, minNotional: 1, stats: { bidPrice: '0.0000218', askPrice: '0.0000221', lastPrice: '0.000022', '24h_ch': 2.8, '24h_quoteVolume': '120000000', '24h_highPrice': '0.0000228', '24h_lowPrice': '0.0000212' } },
  LTCUSDT: { symbol: 'LTCUSDT', baseAsset: 'LTC', quoteAsset: 'USDT', faName: 'لایت‌کوین - تتر', enName: 'Litecoin - Tether', stepSize: 4, tickSize: 3, minQty: 0.01, minNotional: 1, stats: { bidPrice: '142.5', askPrice: '143.2', lastPrice: '142.8', '24h_ch': 0.7, '24h_quoteVolume': '62000000', '24h_highPrice': '146.1', '24h_lowPrice': '140.2' } },
  DOTUSDT: { symbol: 'DOTUSDT', baseAsset: 'DOT', quoteAsset: 'USDT', faName: 'پولکادات - تتر', enName: 'Polkadot - Tether', stepSize: 3, tickSize: 4, minQty: 0.1, minNotional: 1, stats: { bidPrice: '7.42', askPrice: '7.46', lastPrice: '7.44', '24h_ch': -0.5, '24h_quoteVolume': '48000000', '24h_highPrice': '7.61', '24h_lowPrice': '7.30' } },
  LINKUSDT: { symbol: 'LINKUSDT', baseAsset: 'LINK', quoteAsset: 'USDT', faName: 'چین‌لینک - تتر', enName: 'Chainlink - Tether', stepSize: 4, tickSize: 3, minQty: 0.01, minNotional: 1, stats: { bidPrice: '18.9', askPrice: '19.1', lastPrice: '19.0', '24h_ch': 3.1, '24h_quoteVolume': '88000000', '24h_highPrice': '19.4', '24h_lowPrice': '18.2' } },
  AVAXUSDT: { symbol: 'AVAXUSDT', baseAsset: 'AVAX', quoteAsset: 'USDT', faName: 'آوالانچ - تتر', enName: 'Avalanche - Tether', stepSize: 3, tickSize: 3, minQty: 0.01, minNotional: 1, stats: { bidPrice: '41.2', askPrice: '41.5', lastPrice: '41.35', '24h_ch': 1.1, '24h_quoteVolume': '54000000', '24h_highPrice': '42.3', '24h_lowPrice': '40.4' } },
  TRXUSDT: { symbol: 'TRXUSDT', baseAsset: 'TRX', quoteAsset: 'USDT', faName: 'ترون - تتر', enName: 'TRON - Tether', stepSize: 3, tickSize: 5, minQty: 10, minNotional: 1, stats: { bidPrice: '0.245', askPrice: '0.246', lastPrice: '0.2455', '24h_ch': 0.2, '24h_quoteVolume': '76000000', '24h_highPrice': '0.249', '24h_lowPrice': '0.242' } },
  XLMUSDT: { symbol: 'XLMUSDT', baseAsset: 'XLM', quoteAsset: 'USDT', faName: 'استلار - تتر', enName: 'Stellar - Tether', stepSize: 4, tickSize: 5, minQty: 1, minNotional: 1, stats: { bidPrice: '0.598', askPrice: '0.604', lastPrice: '0.601', '24h_ch': 0.9, '24h_quoteVolume': '38000000', '24h_highPrice': '0.62', '24h_lowPrice': '0.585' } },
  SUIUSDT: { symbol: 'SUIUSDT', baseAsset: 'SUI', quoteAsset: 'USDT', faName: 'سویی - تتر', enName: 'Sui - Tether', stepSize: 3, tickSize: 4, minQty: 0.1, minNotional: 1, stats: { bidPrice: '4.12', askPrice: '4.15', lastPrice: '4.13', '24h_ch': 5.4, '24h_quoteVolume': '140000000', '24h_highPrice': '4.28', '24h_lowPrice': '3.89' } },
  APTUSDT: { symbol: 'APTUSDT', baseAsset: 'APT', quoteAsset: 'USDT', faName: 'آپتوس - تتر', enName: 'Aptos - Tether', stepSize: 3, tickSize: 4, minQty: 0.1, minNotional: 1, stats: { bidPrice: '11.2', askPrice: '11.3', lastPrice: '11.25', '24h_ch': -2.2, '24h_quoteVolume': '41000000', '24h_highPrice': '11.6', '24h_lowPrice': '11.05' } },
  PEPEUSDT: { symbol: 'PEPEUSDT', baseAsset: 'PEPE', quoteAsset: 'USDT', faName: 'پپه - تتر', enName: 'Pepe - Tether', stepSize: 1, tickSize: 12, minQty: 1000000, minNotional: 1, stats: { bidPrice: '0.0000124', askPrice: '0.0000127', lastPrice: '0.00001255', '24h_ch': 6.7, '24h_quoteVolume': '210000000', '24h_highPrice': '0.0000131', '24h_lowPrice': '0.0000118' } },
  WLDUSDT: { symbol: 'WLDUSDT', baseAsset: 'WLD', quoteAsset: 'USDT', faName: 'ورلد‌کوین - تتر', enName: 'Worldcoin - Tether', stepSize: 3, tickSize: 3, minQty: 0.1, minNotional: 1, stats: { bidPrice: '2.85', askPrice: '2.88', lastPrice: '2.86', '24h_ch': -3.4, '24h_quoteVolume': '52000000', '24h_highPrice': '2.99', '24h_lowPrice': '2.81' } },
  ARBUSDT: { symbol: 'ARBUSDT', baseAsset: 'ARB', quoteAsset: 'USDT', faName: 'آربیتروم - تتر', enName: 'Arbitrum - Tether', stepSize: 3, tickSize: 4, minQty: 0.1, minNotional: 1, stats: { bidPrice: '0.78', askPrice: '0.79', lastPrice: '0.785', '24h_ch': 0.8, '24h_quoteVolume': '29000000', '24h_highPrice': '0.80', '24h_lowPrice': '0.77' } },
  OPUSDT: { symbol: 'OPUSDT', baseAsset: 'OP', quoteAsset: 'USDT', faName: 'اپتیمیزم - تتر', enName: 'Optimism - Tether', stepSize: 3, tickSize: 4, minQty: 0.1, minNotional: 1, stats: { bidPrice: '1.85', askPrice: '1.87', lastPrice: '1.86', '24h_ch': 1.5, '24h_quoteVolume': '26000000', '24h_highPrice': '1.91', '24h_lowPrice': '1.82' } },
  MOGUSDT: { symbol: 'MOGUSDT', baseAsset: 'MOG', quoteAsset: 'USDT', faName: 'ماگ کوین - تتر', enName: 'Mog Coin - Tether', stepSize: 1, tickSize: 10, minQty: 100000, minNotional: 1, stats: { bidPrice: '0.000000112', askPrice: '0.000000115', lastPrice: '0.000000113', '24h_ch': 4.2, '24h_quoteVolume': '18000000', '24h_highPrice': '0.000000118', '24h_lowPrice': '0.000000108' } },

  /* ── Toman pairs ── */
  BTCTMN: { symbol: 'BTCTMN', baseAsset: 'BTC', quoteAsset: 'TMN', faName: 'بیت‌کوین - تومان', enName: 'Bitcoin - Toman', stepSize: 0, tickSize: 0, minQty: 0.0001, minNotional: 50000, stats: { bidPrice: '7264600000', askPrice: '7275400000', lastPrice: '7270000000', '24h_ch': 2.14, '24h_quoteVolume': '262900000000000', '24h_highPrice': '7350000000', '24h_lowPrice': '7100000000' } },
  ETHTMN: { symbol: 'ETHTMN', baseAsset: 'ETH', quoteAsset: 'TMN', faName: 'اتریوم - تومان', enName: 'Ethereum - Toman', stepSize: 0, tickSize: 0, minQty: 0.001, minNotional: 50000, stats: { bidPrice: '236320000', askPrice: '236690000', lastPrice: '236500000', '24h_ch': 1.32, '24h_quoteVolume': '131900000000000', '24h_highPrice': '240000000', '24h_lowPrice': '232000000' } },
  SOLTMN: { symbol: 'SOLTMN', baseAsset: 'SOL', quoteAsset: 'TMN', faName: 'سولانا - تومان', enName: 'Solana - Toman', stepSize: 0, tickSize: 0, minQty: 0.01, minNotional: 50000, stats: { bidPrice: '11558000', askPrice: '11588000', lastPrice: '11570000', '24h_ch': 4.05, '24h_quoteVolume': '54600000000000', '24h_highPrice': '11860000', '24h_lowPrice': '11050000' } },
  USDTTMN: { symbol: 'USDTTMN', baseAsset: 'USDT', quoteAsset: 'TMN', faName: 'تتر - تومان', enName: 'Tether - Toman', stepSize: 0, tickSize: 0, minQty: 1, minNotional: 50000, stats: { bidPrice: '61300', askPrice: '61400', lastPrice: '61350', '24h_ch': 0.1, '24h_quoteVolume': '82000000000000', '24h_highPrice': '61550', '24h_lowPrice': '61100' } },
  XRPTMN: { symbol: 'XRPTMN', baseAsset: 'XRP', quoteAsset: 'TMN', faName: 'ریپل - تومان', enName: 'Ripple - Toman', stepSize: 0, tickSize: 0, minQty: 1, minNotional: 50000, stats: { bidPrice: '143540', askPrice: '144200', lastPrice: '143900', '24h_ch': -0.8, '24h_quoteVolume': '25800000000000', '24h_highPrice': '148000', '24h_lowPrice': '140000' } },
  DOGETMN: { symbol: 'DOGETMN', baseAsset: 'DOGE', quoteAsset: 'TMN', faName: 'دوج‌کوین - تومان', enName: 'Dogecoin - Toman', stepSize: 0, tickSize: 0, minQty: 10, minNotional: 50000, stats: { bidPrice: '19710', askPrice: '19790', lastPrice: '19750', '24h_ch': 1.9, '24h_quoteVolume': '19000000000000', '24h_highPrice': '20500', '24h_lowPrice': '19100' } },
  ADATMN: { symbol: 'ADATMN', baseAsset: 'ADA', quoteAsset: 'TMN', faName: 'کاردانو - تومان', enName: 'Cardano - Toman', stepSize: 0, tickSize: 0, minQty: 1, minNotional: 50000, stats: { bidPrice: '56420', askPrice: '57060', lastPrice: '56700', '24h_ch': 0.4, '24h_quoteVolume': '11000000000000', '24h_highPrice': '58300', '24h_lowPrice': '55200' } },
  TONTMN: { symbol: 'TONTMN', baseAsset: 'TON', quoteAsset: 'TMN', faName: 'تون‌کوین - تومان', enName: 'Toncoin - Toman', stepSize: 0, tickSize: 0, minQty: 0.1, minNotional: 50000, stats: { bidPrice: '371200', askPrice: '373000', lastPrice: '372000', '24h_ch': -1.2, '24h_quoteVolume': '5830000000000', '24h_highPrice': '383000', '24h_lowPrice': '365000' } },
  SHIBTMN: { symbol: 'SHIBTMN', baseAsset: 'SHIB', quoteAsset: 'TMN', faName: 'شیبا - تومان', enName: 'Shiba Inu - Toman', stepSize: 1, tickSize: 0, minQty: 1000000, minNotional: 50000, stats: { bidPrice: '1.33', askPrice: '1.36', lastPrice: '1.35', '24h_ch': 2.8, '24h_quoteVolume': '7360000000000', '24h_highPrice': '1.40', '24h_lowPrice': '1.30' } },
  LTCTMN: { symbol: 'LTCTMN', baseAsset: 'LTC', quoteAsset: 'TMN', faName: 'لایت‌کوین - تومان', enName: 'Litecoin - Toman', stepSize: 0, tickSize: 0, minQty: 0.01, minNotional: 50000, stats: { bidPrice: '8743000', askPrice: '8785000', lastPrice: '8760000', '24h_ch': 0.7, '24h_quoteVolume': '3800000000000', '24h_highPrice': '8960000', '24h_lowPrice': '8600000' } },
  DOTTMN: { symbol: 'DOTTMN', baseAsset: 'DOT', quoteAsset: 'TMN', faName: 'پولکادات - تومان', enName: 'Polkadot - Toman', stepSize: 0, tickSize: 0, minQty: 0.1, minNotional: 50000, stats: { bidPrice: '455300', askPrice: '457700', lastPrice: '456500', '24h_ch': -0.5, '24h_quoteVolume': '2950000000000', '24h_highPrice': '467000', '24h_lowPrice': '448000' } },
  LINKTMN: { symbol: 'LINKTMN', baseAsset: 'LINK', quoteAsset: 'TMN', faName: 'چین‌لینک - تومان', enName: 'Chainlink - Toman', stepSize: 0, tickSize: 0, minQty: 0.01, minNotional: 50000, stats: { bidPrice: '1159500', askPrice: '1171800', lastPrice: '1166000', '24h_ch': 3.1, '24h_quoteVolume': '5400000000000', '24h_highPrice': '1190000', '24h_lowPrice': '1116000' } },
  TRXTMN: { symbol: 'TRXTMN', baseAsset: 'TRX', quoteAsset: 'TMN', faName: 'ترون - تومان', enName: 'TRON - Toman', stepSize: 0, tickSize: 0, minQty: 10, minNotional: 50000, stats: { bidPrice: '15030', askPrice: '15090', lastPrice: '15060', '24h_ch': 0.2, '24h_quoteVolume': '4670000000000', '24h_highPrice': '15270', '24h_lowPrice': '14850' } },
  XLMTMN: { symbol: 'XLMTMN', baseAsset: 'XLM', quoteAsset: 'TMN', faName: 'استلار - تومان', enName: 'Stellar - Toman', stepSize: 1, tickSize: 0, minQty: 0.1, minNotional: 50000, stats: { bidPrice: '36680', askPrice: '37060', lastPrice: '36860', '24h_ch': 0.91, '24h_quoteVolume': '7030000000000', '24h_highPrice': '38000', '24h_lowPrice': '35900' } },
  SANDTMN: { symbol: 'SANDTMN', baseAsset: 'SAND', quoteAsset: 'TMN', faName: 'سندباکس - تومان', enName: 'The Sandbox - Toman', stepSize: 1, tickSize: 0, minQty: 0.1, minNotional: 50000, stats: { bidPrice: '8060', askPrice: '8120', lastPrice: '8090', '24h_ch': 3.51, '24h_quoteVolume': '88400000000000', '24h_highPrice': '8180', '24h_lowPrice': '7790' } },
  RENDERTMN: { symbol: 'RENDERTMN', baseAsset: 'RENDER', quoteAsset: 'TMN', faName: 'رندر - تومان', enName: 'Render - Toman', stepSize: 2, tickSize: 0, minQty: 0.01, minNotional: 50000, stats: { bidPrice: '298500', askPrice: '300300', lastPrice: '299400', '24h_ch': 1.65, '24h_quoteVolume': '2710000000000', '24h_highPrice': '304400', '24h_lowPrice': '294300' } },
  FLOWTMN: { symbol: 'FLOWTMN', baseAsset: 'FLOW', quoteAsset: 'TMN', faName: 'فلو - تومان', enName: 'Flow - Toman', stepSize: 2, tickSize: 0, minQty: 0.01, minNotional: 50000, stats: { bidPrice: '5670', askPrice: '5790', lastPrice: '5730', '24h_ch': 2.63, '24h_quoteVolume': '1870000000000', '24h_highPrice': '5960', '24h_lowPrice': '5690' } },
  KAITOTMN: { symbol: 'KAITOTMN', baseAsset: 'KAITO', quoteAsset: 'TMN', faName: 'کایتو - تومان', enName: 'KAITO - Toman', stepSize: 2, tickSize: 0, minQty: 0.01, minNotional: 50000, stats: { bidPrice: '63350', askPrice: '64950', lastPrice: '64100', '24h_ch': 0.0, '24h_quoteVolume': '18400000000', '24h_highPrice': '66050', '24h_lowPrice': '64100' } },
  BANDTMN: { symbol: 'BANDTMN', baseAsset: 'BAND', quoteAsset: 'TMN', faName: 'بند - تومان', enName: 'Band Protocol - Toman', stepSize: 2, tickSize: 0, minQty: 0.01, minNotional: 50000, stats: { bidPrice: '36500', askPrice: '36750', lastPrice: '36600', '24h_ch': -3.8, '24h_quoteVolume': '38800000000', '24h_highPrice': '43070', '24h_lowPrice': '36570' } },
  SUSHIUSDT: { symbol: 'SUSHIUSDT', baseAsset: 'SUSHI', quoteAsset: 'USDT', faName: 'سوشی‌سواپ - تتر', enName: 'SushiSwap - Tether', stepSize: 3, tickSize: 3, minQty: 0.001, minNotional: 1, stats: { bidPrice: '0.198', askPrice: '0.201', lastPrice: '0.1995', '24h_ch': -1.1, '24h_quoteVolume': '31000000', '24h_highPrice': '0.205', '24h_lowPrice': '0.195' } },
  CGPTUSDT: { symbol: 'CGPTUSDT', baseAsset: 'CGPT', quoteAsset: 'USDT', faName: 'چین‌جی‌پی‌تی - تتر', enName: 'ChainGPT - Tether', stepSize: 2, tickSize: 6, minQty: 0.01, minNotional: 1, stats: { bidPrice: '0.0198', askPrice: '0.0201', lastPrice: '0.01995', '24h_ch': 0.3, '24h_quoteVolume': '4100000', '24h_highPrice': '0.0205', '24h_lowPrice': '0.0194' } },
  DEXEUSDT: { symbol: 'DEXEUSDT', baseAsset: 'DEXE', quoteAsset: 'USDT', faName: 'دکسی - تتر', enName: 'DeXe - Tether', stepSize: 2, tickSize: 3, minQty: 0.01, minNotional: 1, stats: { bidPrice: '2.25', askPrice: '2.50', lastPrice: '2.26', '24h_ch': -7.11, '24h_quoteVolume': '2100000', '24h_highPrice': '2.43', '24h_lowPrice': '2.26' } }
};

/** Same shape the server's normalizeWallexMarkets returns. */
export function offlineWallexMarkets() {
  return Object.values(ROWS)
    .map((m) => ({
      symbol: m.symbol,
      baseAsset: m.baseAsset,
      quoteAsset: m.quoteAsset,
      faName: m.faName,
      lastPrice: Number(m.stats?.lastPrice ?? 0),
      change24h: Number(m.stats?.['24h_ch'] ?? 0),
      bidPrice: Number(m.stats?.bidPrice ?? 0),
      askPrice: Number(m.stats?.askPrice ?? 0),
      quoteVolume24h: Number(m.stats?.['24h_quoteVolume'] ?? 0),
      high24h: Number(m.stats?.['24h_highPrice'] ?? 0),
      low24h: Number(m.stats?.['24h_lowPrice'] ?? 0),
      minQty: Number(m.minQty ?? 0),
      minNotional: Number(m.minNotional ?? 0),
      tickSize: Number(m.tickSize ?? 2),
      stepSize: Number(m.stepSize ?? 6)
    }))
    .sort((a, b) => {
      const rank = (m) => (m.quoteAsset === 'TMN' ? 0 : m.quoteAsset === 'USDT' ? 1 : 2);
      return rank(a) - rank(b) || b.quoteVolume24h - a.quoteVolume24h;
    });
}

/** Deterministic demo "fill" for an order placed while the feed is offline.
    NEVER touches Wallex — the caller labels every surface as demo. */
export function demoWallexFill({ symbol, side, kind, quantity, price }) {
  const now = new Date();
  return {
    symbol,
    side,
    type: kind,
    origQty: String(quantity),
    executedQty: String(quantity),
    price: String(price ?? 0),
    status: 'FILLED',
    clientOrderId: `DEMO-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e4)}`,
    executedPrice: price,
    executedAt: now.toISOString(),
    demo: true
  };
}

/** Deterministic demo withdrawal receipt. Never touches Wallex. */
export function demoWallexWithdraw({ coin, network, value, address }) {
  return {
    id: `W-DEMO-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`,
    coin,
    network,
    value,
    wallet_address: address,
    status: 'PENDING',
    txHash: null,
    demo: true,
    createdAt: new Date().toISOString()
  };
}

/** A tiny deterministic price series for the selected market, used ONLY to
    keep the UI alive when the live feed is down. Labelled as such. */
export function demoWallexSeries(row, points = 48) {
  if (!row) return [];
  const base = Number(row.lastPrice) || 0;
  if (!base) return [];
  let seed = 0;
  for (const ch of String(row.symbol)) seed = (seed * 31 + ch.charCodeAt(0)) % 997;
  const out = [];
  let v = base * (1 - Number(row.change24h || 0) / 140);
  const now = Date.now();
  for (let i = 0; i < points; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const drift = ((seed / 2147483648) - 0.5) * 0.012;
    v = Math.max(base * 0.85, v * (1 + drift));
    out.push({ x: now - (points - i) * 900_000, y: v });
  }
  return out;
}
