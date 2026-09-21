/**
 * FBT INTENT OS — UPGRADE 13 (4/4): ECONOMIC BRIEF
 * ---------------------------------------------------------------------------
 * «چخبر؟» is not a greeting in a money app. It is the smallest possible way of
 * asking *what is happening to my money and to the market*, and it deserves an
 * answer a person can actually use: the day's move, the majors, a yield worth
 * knowing about, their own wallet, one headline, and how fresh all of it is.
 *
 * The whole design constraint is the product's honesty contract, so:
 *
 *   · every number in the output is copied from the `market` / `yields` /
 *     `portfolio` / `news` payload the caller injected. This module cannot
 *     fetch anything — it has no `fetch`, no import of the API layer, no
 *     default prices, and no `?? 0` anywhere near a figure
 *   · a missing input becomes a **named gap** (`missing: ['yields']`) and a
 *     visible «در دسترس نبود» line, never a rounded-up guess. A brief with an
 *     invented number is worse than no brief, because the user reads a brief as
 *     data
 *   · `assertNoInventedNumbers()` is exported so a test (and the ops panel) can
 *     prove the claim instead of trusting it: it extracts every number from the
 *     rendered text and requires it to be present in the source payload
 *   · the brief is an *observation*, not an instruction: `notAdvice: true` and
 *     `executionAuthorized: false` travel with it, and it never proposes a size
 *
 * Output is one `text` block in the reader's language plus a structured
 * `lines` array, so a UI can render rows instead of a paragraph if it wants.
 */

export const ECONOMIC_BRIEF_SCHEMA = 'fbt.ai-economic-brief.v13';
export const ECONOMIC_BRIEF_VERSION = '13.0.0';

/** Majors shown by default when the user named none. */
export const BRIEF_SYMBOLS = Object.freeze(['BTC', 'ETH', 'SOL']);
const MAX_YIELD_ROWS = 2;
const MAX_NEWS_ROWS = 2;
const MAX_TITLE = 90;

/* -------------------------------------------------------------------------- */
/*  LOCALISATION                                                               */
/* -------------------------------------------------------------------------- */

const L = Object.freeze({
  header: {
    fa: 'خلاصهٔ بازار، همین الان',
    en: 'Market snapshot, right now',
    ar: 'ملخص السوق، الآن',
    tr: 'Piyasa özeti, bu an',
    ru: 'Сводка рынка, прямо сейчас',
    zh: '此刻行情速览',
    hi: 'बाज़ार का संक्षिप्त हाल, अभी',
    ur: 'بازار کا خلاصہ، ابھی',
    id: 'Ringkasan pasar, saat ini',
    es: 'Resumen del mercado, ahora mismo',
    pt: 'Resumo do mercado, agora',
    fr: 'État du marché, à cet instant'
  },
  prices: {
    fa: 'قیمت‌ها', en: 'Prices', ar: 'الأسعار', tr: 'Fiyatlar', ru: 'Цены',
    zh: '价格', hi: 'कीमतें', ur: 'قیمتیں', id: 'Harga', es: 'Precios', pt: 'Preços', fr: 'Prix'
  },
  trend: {
    fa: 'روند ۲۴ ساعت', en: '24h move', ar: 'حركة ٢٤ ساعة', tr: '24 saatlik hareket',
    ru: 'Изменение за 24ч', zh: '24小时走势', hi: '24 घंटे की चाल', ur: '۲۴ گھنٹے کی حرکت',
    id: 'Gerak 24 jam', es: 'Movimiento 24h', pt: 'Movimento 24h', fr: 'Mouvement 24h'
  },
  up: {
    fa: 'بازار بالاخره‌ست', en: 'The market is up', ar: 'السوق صاعد', tr: 'Piyasa yukarıda',
    ru: 'Рынок растёт', zh: '市场上涨', hi: 'बाज़ार ऊपर है', ur: 'بازار اوپر ہے',
    id: 'Pasar naik', es: 'El mercado sube', pt: 'O mercado sobe', fr: 'Le marché monte'
  },
  down: {
    fa: 'بازار زیر فشاره', en: 'The market is under pressure', ar: 'السوق تحت ضغط',
    tr: 'Piyasa baskı altında', ru: 'Рынок под давлением', zh: '市场承压',
    hi: 'बाज़ार पर दबाव है', ur: 'بازار پر دباؤ ہے', id: 'Pasar tertekan',
    es: 'El mercado está presionado', pt: 'O mercado está pressionado', fr: 'Le marché est sous pression'
  },
  flat: {
    fa: 'بازار بی‌حرکه', en: 'The market is flat', ar: 'السوق مستقر', tr: 'Piyasa yatay',
    ru: 'Рынок ровно', zh: '市场横盘', hi: 'बाज़ार स्थिर है', ur: 'بازار سیدھ میں ہے',
    id: 'Pasar datar', es: 'El mercado está plano', pt: 'O mercado está lateral', fr: 'Le marché est plat'
  },
  unknownTrend: {
    fa: 'تغییر لحظه‌ای خوانده نشد', en: 'Live change unavailable', ar: 'التغيرغير متاح',
    tr: 'Anlık değişim okunamadı', ru: 'Живое изменение недоступно', zh: '无法读取实时变动',
    hi: 'लाइव बदलाव उपलब्ध नहीं', ur: 'لائیو تبدیلی دستیاب نہیں', id: 'Perubahan langsung tak tersedia',
    es: 'Cambio en vivo no disponible', pt: 'Variação ao vivo indisponível', fr: 'Variation temps réel indisponible'
  },
  yield: {
    fa: 'بازده قابل‌توجه', en: 'Yield worth noting', ar: 'عائد جدير بالملاحظة',
    tr: 'Dikkat çeken getiri', ru: 'Заметная доходность', zh: '值得关注的收益',
    hi: 'उल्लेखनीय यील्ड', ur: 'قابلِ توجہ ییلڈ', id: 'Yield yang layak dicatat',
    es: 'Rendimiento a destacar', pt: 'Rendimento a notar', fr: 'Rendement à noter'
  },
  wallet: {
    fa: 'کیف پول شما', en: 'Your wallet', ar: 'محفظتك', tr: 'Cüzdanın', ru: 'Твой кошелёк',
    zh: '你的钱包', hi: 'आपका वॉलेट', ur: 'آپ کا والیٹ', id: 'Dompetmu', es: 'Tu billetera',
    pt: 'A tua carteira', fr: 'Ton portefeuille'
  },
  walletNotConnected: {
    fa: 'متصل نیست — برای همین عددی از دارایی نمی‌گم', en: 'not connected — so I say nothing about your holdings',
    ar: 'غير متصل — لذلك لا أقول شيئًا عن أرصدتك', tr: 'bağlı değil — bu yüzden varlıkların hakkında bir şey söylemiyorum',
    ru: 'не подключён — поэтому о балансах молчу', zh: '未连接，所以我不谈你的持仓',
    hi: 'कनेक्ट नहीं है — इसलिए holdings के बारे में कुछ नहीं', ur: 'منسلک نہیں — اس لیے ہولڈنگز پر کچھ نہیں',
    id: 'tidak terhubung — jadi aku tidak bicara soal asetmu', es: 'sin conectar — no hablo de tus tenencias',
    pt: 'desligada — não falo das tuas posições', fr: 'non connecté — je ne parle pas de tes positions'
  },
  concentrated: {
    fa: 'بیش از ۶۰٪ روی یک دارایی', en: 'over 60% in one asset', ar: 'أكثر من ٦٠٪ في أصل واحد',
    tr: 'tek bir varlıkta %60 üstü', ru: 'более 60% в одном активе', zh: '单一资产占比超过 60%',
    hi: 'एक परिसंपत्ति में 60% से अधिक', ur: 'ایک اثاثے میں ۶۰٪ سے زیادہ', id: 'lebih dari 60% di satu aset',
    es: 'más del 60% en un solo activo', pt: 'mais de 60% num único ativo', fr: 'plus de 60% sur un seul actif'
  },
  news: {
    fa: 'یک خبر', en: 'A headline', ar: 'خبر', tr: 'Bir başlık', ru: 'Заголовок',
    zh: '一条新闻', hi: 'एक सुर्खी', ur: 'ایک خبر', id: 'Sebuah judul', es: 'Un titular',
    pt: 'Uma manchete', fr: 'Un titre'
  },
  unavailable: {
    fa: 'در دسترس نبود', en: 'unavailable', ar: 'غير متاح', tr: 'uygun değildi',
    ru: 'недоступно', zh: '不可用', hi: 'अनुपलब्ध', ur: 'دستیاب نہیں', id: 'tidak tersedia',
    es: 'no disponible', pt: 'indisponível', fr: 'indisponible'
  },
  stale: {
    fa: 'دادهٔ کش‌شده', en: 'cached data', ar: 'بيانات مخزنة', tr: 'önbellek verisi',
    ru: 'данные из кэша', zh: '缓存数据', hi: 'कैश्ड डेटा', ur: 'کیش ڈیٹا', id: 'data tembolok',
    es: 'datos en caché', pt: 'dados em cache', fr: 'données en cache'
  },
  notAdvice: {
    fa: 'این فقط خواندنِ داده‌ست، نه پیشنهاد مالی.', en: 'This is a read of the data, not financial advice.',
    ar: 'هذه قراءة للبيانات ولي نصيحة مالية.', tr: 'Bu verinin okunmasıdır, yatırım tavsiyesi değil.',
    ru: 'Это чтение данных, а не финансовый совет.', zh: '这只是数据解读，不是投资建议。',
    hi: 'यह डेटा का अवलोकन है, वित्तीय सलाह नहीं।', ur: 'یہ ڈیٹا کی روایت ہے، مالی مشورہ نہیں۔',
    id: 'Ini pembacaan data, bukan saran keuangan.', es: 'Es una lectura de datos, no asesoramiento financiero.',
    pt: 'Isto é uma leitura dos dados, não aconselhamento financeiro.', fr: 'C\u2019est une lecture des données, pas un conseil financier.'
  }
});

const DIGITS = Object.freeze({
  fa: ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'],
  ur: ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'],
  ar: ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'],
  hi: ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९']
});
/** Currencies that use a comma decimal separator in these locales. */
const COMMA_DECIMAL = new Set(['tr', 'ru', 'id', 'es', 'pt', 'fr']);

export function localizeNumber(value, lang, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const fixed = Math.abs(n) >= 1000
    ? Math.round(n).toLocaleString('en-US')           // 63,412
    : n.toFixed(digits).replace(/\.?0+$/, '');
  let out = COMMA_DECIMAL.has(lang) ? fixed.replace('.', '\u0000').replace(/,/g, '.').replace('\u0000', ',') : fixed;
  const set = DIGITS[lang];
  if (set) out = [...out].map((ch) => (/[0-9]/.test(ch) ? set[Number(ch)] : ch)).join('');
  return out;
}

/** Compact USD, e.g. $63.4K / $1.2M, with the reader's digit system. */
export function money(n, lang) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const abs = Math.abs(v);
  let body;
  let unit = '';
  if (abs >= 1e12) { body = v / 1e12; unit = 'T'; } else if (abs >= 1e9) { body = v / 1e9; unit = 'B'; } else if (abs >= 1e6) { body = v / 1e6; unit = 'M'; } else if (abs >= 1e3) { body = v / 1e3; unit = 'K'; } else { body = v; }
  const text = localizeNumber(Number(body.toFixed(body >= 100 ? 0 : 1)), lang, body >= 100 ? 0 : 1);
  return text === null ? null : `$${text}${unit}`;
}

export function percent(n, lang) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const body = localizeNumber(Math.abs(v), lang, 1);
  if (body === null) return null;
  const sign = v > 0.049 ? '▲' : v < -0.049 ? '▼' : '·';
  return `${sign} ${body}%`;
}

/* Labels carry numbers too («24h move», «over 60%»), and a Persian sentence
   must not have one ASCII island in it. The same digit set applies there. */
const localizeDigits = (text, lang) => {
  const set = DIGITS[lang];
  return set ? [...String(text)].map((ch) => (/\d/.test(ch) ? set[Number(ch)] : ch)).join('') : String(text);
};
const label = (key, lang) => localizeDigits(String(L[key]?.[lang] ?? L[key]?.en ?? key), lang);

/* -------------------------------------------------------------------------- */
/*  BUILD                                                                      */
/* -------------------------------------------------------------------------- */

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

function moodOf(change24hPct) {
  const c = num(change24hPct);
  if (c === null) return 'unknown';
  if (c >= 2) return 'up';
  if (c <= -2) return 'down';
  return 'flat';
}

/**
 * Build the brief.
 *
 * @param {object} input
 * @param {object} [input.market]    { dataStatus, priceMap:{BTC,ETH,SOL}, change24hPct, capturedAt }
 * @param {Array}  [input.yields]   [{protocol,symbol,apy,riskBand,tvlUsd}]
 * @param {object} [input.portfolio]{ dataStatus, totalValueUsd, holdings:[{symbol,pct|usd}] }
 * @param {object} [input.wallet]   { connected }
 * @param {Array}  [input.news]     [{title,source,at}]
 * @param {string} [input.lang]     locale code (the one the user is *writing*)
 * @param {number} [input.now]      injectable clock, for a testable stamp
 */
export function buildEconomicBrief({
  market = null,
  yields = null,
  portfolio = null,
  wallet = null,
  news = null,
  lang = 'en',
  now = Date.now()
} = {}) {
  const locale = String(lang || 'en').toLowerCase().split('-')[0];
  const missing = [];
  const lines = [];

  const priceMap = market?.priceMap && typeof market.priceMap === 'object' ? market.priceMap : null;
  const marketLive = market?.dataStatus ? market.dataStatus === 'live' : Boolean(priceMap);
  const change = num(market?.change24hPct);
  const mood = moodOf(change);

  /* 1 — the one-line read of the day. */
  const headline = mood === 'up' ? label('up', locale)
    : mood === 'down' ? label('down', locale)
      : mood === 'flat' ? label('flat', locale)
        : label('unknownTrend', locale);
  if (mood === 'unknown') missing.push('market.change24hPct');
  lines.push({ key: 'trend', label: label('trend', locale), text: headline, value: change });

  /* 2 — majors. A symbol we cannot price is named and marked unavailable,
        never dropped, so the reader knows they were heard. */
  const priceRows = [];
  if (priceMap) {
    for (const symbol of BRIEF_SYMBOLS) {
      const price = num(priceMap[symbol]);
      if (price === null) { priceRows.push({ symbol, text: `${symbol} ${label('unavailable', locale)}`, price: null }); continue; }
      priceRows.push({ symbol, text: `${symbol} ${money(price, locale)}`, price });
    }
    if (priceRows.some((r) => r.price === null)) missing.push('market.price');
  } else {
    missing.push('market.priceMap');
    priceRows.push({ symbol: null, text: `${label('prices', locale)}: ${label('unavailable', locale)}`, price: null });
  }
  if (priceRows.length) lines.push({ key: 'prices', label: label('prices', locale), rows: priceRows, text: priceRows.map((r) => r.text).join(' · ') });

  /* 3 — a yield worth knowing, filtered to the bands the app calls
        conservative, and only when the payload actually carries an APY. */
  const pools = Array.isArray(yields) ? yields.filter((p) => num(p?.apy) !== null) : null;
  if (!pools || !pools.length) {
    missing.push('yields');
  } else {
    const best = [...pools]
      .filter((p) => !/high|very[- ]high/i.test(String(p.riskBand || '')))
      .sort((a, b) => (num(b.apy) || 0) - (num(a.apy) || 0))
      .slice(0, MAX_YIELD_ROWS);
    if (!best.length) {
      lines.push({ key: 'yield', label: label('yield', locale), text: `${label('yield', locale)}: ${label('unavailable', locale)}`, rows: [] });
      missing.push('yields.safe');
    } else {
      lines.push({
        key: 'yield',
        label: label('yield', locale),
        rows: best.map((p) => ({ protocol: p.protocol || null, symbol: p.symbol || null, apy: num(p.apy) })),
        text: `${label('yield', locale)}: ${best.map((p) => `${p.symbol || p.protocol || '?'} ${localizeNumber(num(p.apy), locale, 1)}%${p.protocol && p.symbol ? ` · ${p.protocol}` : ''}`).join(' · ')}`
      });
    }
  }

  /* 4 — their own money. If the wallet is not connected we say that instead of
        quoting someone else's number or a zero. */
  if (wallet && wallet.connected === false) {
    lines.push({ key: 'wallet', label: label('wallet', locale), text: `${label('wallet', locale)}: ${label('walletNotConnected', locale)}`, connected: false });
    missing.push('portfolio');
  } else {
    const total = num(portfolio?.totalValueUsd);
    if (total === null) {
      lines.push({ key: 'wallet', label: label('wallet', locale), text: `${label('wallet', locale)}: ${label('unavailable', locale)}`, connected: null });
      missing.push('portfolio.totalValueUsd');
    } else {
      const holdings = Array.isArray(portfolio?.holdings) ? portfolio.holdings : [];
      const top = holdings
        .map((h) => ({ symbol: String(h?.symbol || '').toUpperCase(), pct: num(h?.pct ?? (num(h?.usd) !== null && total ? (num(h.usd) / total) * 100 : null)) }))
        .filter((h) => h.symbol && num(h.pct) !== null)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 3);
      const concentration = top.length ? ` · ${top.map((h) => `${h.symbol} ${localizeNumber(h.pct, locale, 0)}%`).join(' / ')}` : '';
      const concentrated = top.length && top[0].pct >= 60;
      const warning = concentrated ? ` — ${label('concentrated', locale)}` : '';
      lines.push({
        key: 'wallet',
        label: label('wallet', locale),
        connected: true,
        totalValueUsd: total,
        concentrated,
        text: `${label('wallet', locale)}: ${money(total, locale)}${concentration}${warning}`
      });
    }
  }

  /* 5 — one headline, only if a real feed was injected. Never a summary
        written from imagination: the title is the publisher's own words. */
  /* The server hands the whole news context ({ dataStatus, items }) and tests hand
     the bare list; both mean the same thing here. */
  const newsRows = Array.isArray(news) ? news : (Array.isArray(news?.items) ? news.items : []);
  const headlines = newsRows.filter((n) => String(n?.title || '').trim()).slice(0, MAX_NEWS_ROWS);
  if (!headlines.length) missing.push('news');
  else {
    lines.push({
      key: 'news',
      label: label('news', locale),
      rows: headlines.map((n) => ({ source: n.source || null, at: num(n.at) ?? null })),
      text: `${label('news', locale)}: ${headlines.map((n) => `«${String(n.title).trim().slice(0, MAX_TITLE)}»`).join(' ')}`
    });
  }

  /* 6 — freshness, stated. A cached read is called cached. */
  const capturedAt = num(market?.capturedAt);
  const ageSec = capturedAt !== null ? Math.max(0, Math.round((Number(now) - capturedAt) / 1000)) : null;
  /* A live, recent snapshot needs no stamp — saying nothing is the honest
     default, and a «به‌روز» badge nobody asked for is how stale data starts
     looking fine. The stamp only appears when it carries bad news. */
  let stamp = null;
  if (!marketLive) {
    stamp = `${label('stale', locale)} · ${label('unavailable', locale)}`;
  } else if (ageSec !== null && ageSec > 90) {
    const age = ageSec >= 3600
      ? `${localizeNumber(Math.round(ageSec / 3600), locale, 0)}h`
      : `${localizeNumber(Math.round(ageSec / 60), locale, 0)}min`;
    stamp = `${label('stale', locale)} (${age})`;
  }

  const body = lines.map((l) => `• ${l.text}`).join('\n');
  const text = [`${label('header', locale)}`, body, label('notAdvice', locale), stamp].filter(Boolean).join('\n');

  /* `usedValues` is the audit trail: every figure the renderer put in the text,
     with where it came from. The prose is built from these and nothing else. */
  const usedValues = [];
  const collect = (value, from) => { const n = num(value); if (n !== null) usedValues.push({ value: n, from }); };
  if (priceMap) for (const [symbol, price] of Object.entries(priceMap)) collect(price, `market.priceMap.${symbol}`);
  collect(change, 'market.change24hPct');
  for (const pool of (Array.isArray(yields) ? yields : [])) { collect(pool?.apy, 'yields.apy'); collect(pool?.tvlUsd, 'yields.tvlUsd'); }
  if (portfolio?.totalValueUsd != null) collect(portfolio.totalValueUsd, 'portfolio.totalValueUsd');
  for (const h of (Array.isArray(portfolio?.holdings) ? portfolio.holdings : [])) { collect(h?.pct, 'portfolio.holdings.pct'); collect(h?.usd, 'portfolio.holdings.usd'); }
  if (capturedAt !== null) collect(ageSec, 'market.ageSeconds');

  return {
    ok: true,
    schema: ECONOMIC_BRIEF_SCHEMA,
    lang: locale,
    /* 'live' only when nothing is missing; 'partial' when at least one line
       carries a real figure; 'unavailable' when the payload was empty — the
       reader sees the difference, and so does the gate in aiIntentOS. */
    dataStatus: missing.length === 0
      ? 'live'
      : (usedValues.length ? 'partial' : 'unavailable'),
    mood,
    change24hPct: change,
    lines,
    text,
    numbers: extractDigits(text),
    usedValues,
    missing,
    sources: {
      market: market ? (market.dataStatus || 'live') : 'unavailable',
      yields: pools ? pools.length : 0,
      news: headlines.length,
      portfolio: portfolio ? (portfolio.dataStatus || 'client') : 'unavailable'
    },
    at: Number(now),
    notAdvice: true,
    executionAuthorized: false,
    requiresSignatureForAnything: false
  };
}

/** Every digit group visible in a rendered string, as numbers. */
/* Non-ASCII digit systems the app renders in: Arabic-Indic, Extended
   (Persian/Urdu), Devanagari. Mapped to ASCII before any number is parsed, so
   «۶۳.۴» and «٦٣,٤» are read by exactly the same rules as «63.4». */
const DIGIT_SETS = Object.freeze([
  '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669',
  '\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9',
  '\u0966\u0967\u0968\u0969\u096A\u096B\u096C\u096D\u096E\u096F'
]);

/** Re-join separators into one JS-parsable decimal string. */
export function normalizeSeparators(value) {
  /* Read in any digit system first: a helper that answers `.` when handed `۶۳.۴`
     is a trap for the next caller, even though the internal path maps digits. */
  let str = '';
  for (const ch of String(value ?? '')) {
    let mapped = null;
    for (const set of DIGIT_SETS) {
      const idx = set.indexOf(ch);
      if (idx >= 0) { mapped = String(idx); break; }
    }
    str += mapped ?? ch;
  }
  if (!/[.,]/.test(str)) return str;
  const lastSep = Math.max(str.lastIndexOf('.'), str.lastIndexOf(','));
  const head = str.slice(0, lastSep);
  const tail = str.slice(lastSep + 1);
  /* `63,4` is a decimal, `1,234` is a thousands group. Length decides. */
  const tailIsDecimal = tail.length > 0 && tail.length < 3;
  const joined = tailIsDecimal ? `${head}.${tail}` : `${head}${tail}`;
  const out = joined.replace(/[^\d.\-]/g, '');
  return out === '' || out === '-' ? '0' : out;
}

/**
 * Every number visible in a rendered string. Deliberately conservative: a
 * digit group that cannot be read is skipped rather than guessed, because this
 * function is the honesty checker — being wrong here means crying wolf on real
 * output, and a team that is cried wolf at stops trusting the gate.
 */
export function extractDigits(text) {
  let ascii = '';
  for (const ch of String(text ?? '')) {
    let mapped = null;
    for (const set of DIGIT_SETS) {
      const idx = set.indexOf(ch);
      if (idx >= 0) { mapped = String(idx); break; }
    }
    ascii += mapped ?? ch;
  }
  const out = [];
  for (const m of ascii.match(/[-+]?\d[\d.,]*/g) || []) {
    const value = Number(normalizeSeparators(m));
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

/** Digits that live inside the localised labels (e.g. "24h move", "60%").
 *  They are part of the wording, so they are allowed without a source value. */
function labelDigits(locale) {
  const set = new Set();
  for (const row of Object.values(L)) {
    for (const value of Object.values(row || {})) {
      for (const n of extractDigits(value)) set.add(Math.abs(n));
    }
  }
  return set;
}

/** The display transformations this module is allowed to apply to a source
 *  number: rounding to 0/1/2 decimals and the K/M/B/T compaction. */
function displayFamily(n) {
  const abs = Math.abs(Number(n));
  if (!Number.isFinite(abs)) return [];
  const out = [];
  for (const scale of [1, 1e3, 1e6, 1e9, 1e12]) {
    const v = abs / scale;
    for (const d of [0, 1, 2]) out.push(Number(v.toFixed(d)));
  }
  return out;
}

/**
 * The honesty proof. Every number that reaches the reader must be a legal
 * display transformation of a number the caller injected, or a digit that
 * belongs to the localised wording. Anything else is an invention and is
 * returned as an offender rather than thrown, so a probe can print it.
 */
export function assertNoInventedNumbers(brief, source = {}) {
  const allowed = new Set(labelDigits(String(brief?.lang || 'en')));
  allowed.add(0);
  for (const used of brief?.usedValues || []) {
    for (const v of displayFamily(used.value)) allowed.add(v);
  }
  /* Values from the payload that were not recorded (a caller passing a plain
     object into the test) still count as legitimate. */
  for (const m of JSON.stringify(source).match(/-?\d+(?:\.\d+)?/g) || []) {
    for (const v of displayFamily(Number(m))) allowed.add(v);
  }
  const invented = [];
  for (const n of brief?.numbers || []) {
    if (!allowed.has(Math.abs(n))) invented.push(n);
  }
  return {
    ok: invented.length === 0,
    invented,
    checked: (brief?.numbers || []).length,
    provenance: (brief?.usedValues || []).length,
    schema: ECONOMIC_BRIEF_SCHEMA
  };
}

/**
 * The other half of the law: with nothing injected, the brief must not produce
 * a single figure. An empty payload producing an empty brief is the correct
 * behaviour; a populated one is the bug this catches.
 */
export function emptyPayloadStaysEmpty() {
  const brief = buildEconomicBrief({ lang: 'en', now: 0 });
  const figures = extractDigits(brief.text).filter((n) => !labelDigits('en').has(Math.abs(n)));
  return {
    ok: brief.dataStatus === 'unavailable' && figures.length === 0,
    dataStatus: brief.dataStatus,
    figures,
    missing: brief.missing
  };
}

export default buildEconomicBrief;
