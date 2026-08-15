// Merge new keys into en.json and fa.json without overwriting existing strings.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', 'src', 'i18n', 'locales');

const NEW_EN = {
  news: {
    tab: {
      whales: 'Whales'
    }
  },
  settings: {
    privacySection: 'Privacy',
    telemetryTitle: 'Data contributes to model improvements',
    telemetryBody:
      'The signal engine gets better by learning from what actually happened after each read. Turning this on shares only anonymized outcomes with the daily training run — never your addresses, wallet keys, IP address, or any identifier.',
    contributeTelemetry: 'Share anonymous signal outcomes',
    contributeTelemetrySub: 'No addresses, no keys, no IPs, no user IDs',
    telemetryNote:
      'Each record is under 120 bytes: a hashed coin id, the read (stance, confidence, market regime, model version) and the outcome that later occurred. Nothing about you can be recovered from it, and the app behaves identically whether this is on or off.'
  },
  verdict: {
    calibrated: 'Calibrated on the last {{n}} outcomes — model v{{date}}'
  },
  whales: {
    title: 'Whale Tracking',
    subtitle: 'Recent large on-chain transfers',
    loading: 'Loading whale transactions…',
    refresh: 'Refresh',
    updated: 'Updated {{ago}}',
    stale: 'stale',
    partial: 'Some chains are unavailable; showing partial results',
    coverage: '{{priced}} of {{total}} events priced (estimates)',
    error: 'Could not load whale transactions',
    errorBody: 'Public RPCs may be rate-limited. Pull to retry.',
    rateLimited: 'Rate limited',
    rateLimitedBody: 'Slow down — the public feed limits how often we can poll.',
    empty: 'No whale transactions match your filters',
    emptyBody: 'Try a smaller threshold, a wider time window, or All networks.',
    retry: 'Retry',
    searchToken: 'Search by token',
    allChains: 'All',
    threshold: {
      '10k': '$10k+',
      '100k': '$100k+',
      '1m': '$1M+',
      '10m': '$10M+'
    },
    time: {
      '1h': '1h',
      '6h': '6h',
      '24h': '24h',
      all: 'All'
    },
    kind: {
      transfer: 'Transfer',
      mint: 'Mint',
      burn: 'Burn',
      inflow: 'Inflow',
      outflow: 'Outflow',
      contract: 'Contract'
    },
    unverified: 'unverified',
    unknown: 'Unknown',
    noPrice: 'no price',
    estimated: 'estimate',
    disclaimer: 'Events are sourced from public RPCs and block explorers. Address labels are shown only when our curated registry recognises them; unknown senders and recipients stay "Unknown". Fiat values are estimates using current market prices.'
  },
  wallet: {
    notConnected: 'Not connected',
    connectCta: 'Connect to see your portfolio',
    portfolioTotal: 'Total portfolio',
    coverageShort: '{{priced}}/{{total}} priced',
    network: 'Network',
    allNetworks: 'All networks',
    networks: 'Networks',
    networksUnit: 'networks',
    assetsUnit: 'assets',
    active: 'Active',
    chainUnavailable: 'temporarily unavailable',
    assets: 'Assets',
    searchAssets: 'Search assets…',
    noAssets: 'No assets found on connected chains',
    noAssetsChain: 'No assets on this network above the dust threshold',
    switchErr: {
      REJECTED: 'Switch was rejected',
      FAILED: 'Could not switch network'
    }
  }
};

const NEW_FA = {
  news: {
    tab: {
      whales: 'نهنگ‌ها'
    }
  },
  settings: {
    privacySection: 'حریم خصوصی',
    telemetryTitle: 'داده‌ها به بهبود مدل کمک می‌کنند',
    telemetryBody:
      'موتور سیگنال با یادگیری از آنچه پس از هر خوانش واقعاً رخ داد بهتر می‌شود. با روشن‌کردن این گزینه فقط نتایج ناشناس با فرایند آموزش روزانه به اشتراک گذاشته می‌شود — هرگز آدرس، کلید کیف پول، آدرس IP یا هیچ شناسه‌ای.',
    contributeTelemetry: 'اشتراک‌گذاری نتیجهٔ سیگنال‌های ناشناس',
    contributeTelemetrySub: 'بدون آدرس، بدون کلید، بدون IP، بدون شناسهٔ کاربر',
    telemetryNote:
      'هر رکورد کمتر از ۱۲۰ بایت است: شناسهٔ هش‌شدهٔ سکه، خوانش (جهت، اطمینان، وضعیت بازار، نسخهٔ مدل) و نتیجه‌ای که بعداً رخ داد. هیچ اطلاعاتی دربارهٔ شما از آن قابل بازسازی نیست و اپ چه این گزینه روشن باشد چه خاموش، دقیقاً یکسان رفتار می‌کند.'
  },
  verdict: {
    calibrated: 'کالیبره‌شده روی {{n}} نتیجهٔ اخیر — مدل v{{date}}'
  },
  whales: {
    title: 'ردیابی نهنگ‌ها',
    subtitle: 'تراکنش‌های درشت اخیر روی بلاکچین',
    loading: 'در حال بارگذاری تراکنش‌های بزرگ…',
    refresh: 'به‌روزرسانی',
    updated: '{{ago}} به‌روز شد',
    stale: 'کهنه',
    partial: 'بعضی زنجیرها در دسترس نیستند؛ نتیجه ناقص است',
    coverage: '{{priced}} از {{total}} رویداد قیمت‌گذاری شده (تخمینی)',
    error: 'امکان بارگذاری تراکنش‌های بزرگ وجود ندارد',
    errorBody: 'ممکن است RPCهای عمومی محدود شده باشند. دوباره تلاش کنید.',
    rateLimited: 'محدودیت نرخ',
    rateLimitedBody: 'کمی صبر کنید — سرویس تعداد درخواست را محدود کرده است.',
    empty: 'هیچ تراکنش بزرگی با فیلترهای شما پیدا نشد',
    emptyBody: 'آستانه کوچک‌تر، بازه زمانی وسیع‌تر یا همه شبکه‌ها را امتحان کنید.',
    retry: 'تلاش مجدد',
    searchToken: 'جستجو بر اساس توکن',
    allChains: 'همه',
    threshold: {
      '10k': '$10k+',
      '100k': '$100k+',
      '1m': '$1M+',
      '10m': '$10M+'
    },
    time: {
      '1h': '۱س',
      '6h': '۶س',
      '24h': '۲۴س',
      all: 'همه'
    },
    kind: {
      transfer: 'انتقال',
      mint: 'ضرب',
      burn: 'سوزاندن',
      inflow: 'ورود به صرافی',
      outflow: 'خروج از صرافی',
      contract: 'قرارداد'
    },
    unverified: 'تأیید نشده',
    unknown: 'ناشناس',
    noPrice: 'بدون قیمت',
    estimated: 'تخمینی',
    disclaimer: 'رویدادها از RPCهای عمومی و کاوشگرهای بلاک دریافت می‌شوند. برچسب آدرس‌ها فقط وقتی نمایش داده می‌شود که فهرست تأیید شده ما آن را بشناسد؛ فرستنده و گیرنده ناشناس «ناشناس» باقی می‌ماند. مقادیر فیات تخمینی بر اساس قیمت لحظه‌ای بازار هستند.'
  },
  wallet: {
    notConnected: 'متصل نیست',
    connectCta: 'برای دیدن پرتفولیو متصل شوید',
    portfolioTotal: 'مجموع پرتفولیو',
    coverageShort: '{{priced}}/{{total}} قیمت‌دار',
    network: 'شبکه',
    allNetworks: 'همه شبکه‌ها',
    networks: 'شبکه‌ها',
    networksUnit: 'شبکه',
    assetsUnit: 'دارایی',
    active: 'فعال',
    chainUnavailable: 'موقتاً در دسترس نیست',
    assets: 'دارایی‌ها',
    searchAssets: 'جستجوی دارایی…',
    noAssets: 'در شبکه‌های متصل دارایی یافت نشد',
    noAssetsChain: 'در این شبکه دارایی بالاتر از آستانه موجود نیست',
    switchErr: {
      REJECTED: 'تعویض شبکه لغو شد',
      FAILED: 'تعویض شبکه ممکن نشد'
    }
  }
};

function deepMerge(target, patch) {
  if (Array.isArray(patch)) return patch;
  if (patch && typeof patch === 'object') {
    const out = { ...(target && typeof target === 'object' ? target : {}) };
    for (const [k, v] of Object.entries(patch)) {
      out[k] = deepMerge(out[k], v);
    }
    return out;
  }
  return target == null ? patch : target;
}

function writeIfMissing(lang, patch) {
  const fp = path.join(ROOT, `${lang}.json`);
  const current = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const merged = deepMerge(current, patch);
  fs.writeFileSync(fp, JSON.stringify(merged, null, 2) + '\n');
  console.log(`updated ${lang}.json`);
}

writeIfMissing('en', NEW_EN);
writeIfMissing('fa', NEW_FA);
