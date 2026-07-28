/**
 * SERVER-SENT WEB PUSH
 * ---------------------------------------------------------------------------
 * The daily notification used to be scheduled in the browser, which sounds
 * fine until you look at when it actually fires: `maybeSendDailyPromo` runs on
 * app open, so the only person who ever received the "come back to the app"
 * notification was someone already in the app. As re-engagement it was
 * decorative.
 *
 * This module sends them properly — from the server, to devices that are not
 * running the app, which is the entire point of push.
 *
 * WHAT IS AND IS NOT GUARANTEED
 * Push delivery is best-effort by design. Browsers and phone OSs batch,
 * delay and drop notifications to save battery, and a device that has been
 * offline for days may never receive a queued message. We do not retry: a
 * promotional notification that arrives a day late is worse than one that
 * never arrives. Trade and security notifications are a different matter and
 * should be re-surfaced in-app on next open rather than relied on via push.
 *
 * DEAD SUBSCRIPTIONS
 * A 404 or 410 from a push service means the browser has permanently revoked
 * that subscription — the app was uninstalled, or the user cleared site data.
 * We prune those immediately. Left alone they accumulate forever and every
 * future send wastes time on endpoints that can never deliver.
 */

import { readSubscriptions, removeSubscription } from './store.js';

const PUBLIC_KEY = process.env.VITE_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@example.com';

export const pushConfigured = () => Boolean(PUBLIC_KEY && PRIVATE_KEY);

let webpush = null;

/** Lazy-load so the dependency is not pulled in when push is unconfigured. */
async function lib() {
  if (!pushConfigured()) return null;
  if (!webpush) {
    try {
      const mod = await import('web-push');
      webpush = mod.default ?? mod;
      webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    } catch {
      return null;
    }
  }
  return webpush;
}

/**
 * Send one payload to every stored subscription.
 *
 * @param {(lang:string) => {title:string, body:string, url?:string}} build
 *        Called per subscription so each device gets the message in the
 *        language it registered with. Localising on the server matters here:
 *        the notification renders in the OS shade, where the app has no
 *        opportunity to translate anything.
 */
export async function broadcast(build, { tag = 'fbt-daily' } = {}) {
  const wp = await lib();
  if (!wp) return { sent: 0, failed: 0, pruned: 0, reason: 'NOT_CONFIGURED' };

  const subs = await readSubscriptions();
  let sent = 0;
  let failed = 0;
  const dead = [];

  // Chunked rather than one big Promise.all: a few thousand simultaneous TLS
  // handshakes will trip the connection limits of a small host, and the whole
  // job then fails instead of just being slow.
  const CHUNK = 50;
  for (let i = 0; i < subs.length; i += CHUNK) {
    const batch = subs.slice(i, i + CHUNK);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      batch.map(async (sub) => {
        const payload = build(sub.lang || 'fa');
        try {
          await wp.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({ ...payload, tag }),
            { TTL: 12 * 3600 } // a stale promo is worse than none
          );
          sent += 1;
        } catch (err) {
          failed += 1;
          const code = err?.statusCode;
          if (code === 404 || code === 410) dead.push(sub.endpoint);
        }
      })
    );
  }

  for (const endpoint of dead) {
    // eslint-disable-next-line no-await-in-loop
    await removeSubscription(endpoint).catch(() => {});
  }

  return { sent, failed, pruned: dead.length, total: subs.length };
}

/**
 * Rotating daily copy, mirroring `pickPromoKey` in the client so the two
 * schedulers never disagree about which message today is.
 */
const PROMOS = {
  promo1: {
    fa: ['بازار امروز چطور بود؟', 'قیمت زنده بیش از هزار ارز، رایگان و بدون ثبت‌نام.'],
    en: ['How did the market move today?', 'Live prices for a thousand-plus coins, free and with no signup.'],
    ar: ['كيف تحرك السوق اليوم؟', 'أسعار حية لأكثر من ألف عملة مجاناً.']
  },
  promo2: {
    fa: ['سواپ روی ۷ شبکه', 'BNB، اتریوم، پالیگان، آربیتروم، بیس، اپتیمیسم و آوالانچ — همه از کیف پول خودت.'],
    en: ['Swap across 7 networks', 'BNB, Ethereum, Polygon, Arbitrum, Base, Optimism and Avalanche — all from your own wallet.'],
    ar: ['التبادل على ٧ شبكات', 'من محفظتك مباشرة على سبع شبكات.']
  },
  promo3: {
    fa: ['خبرهای امروز رمزارز', 'خلاصه اخبار مهم بازار، هر ۲۴ ساعت یک بار.'],
    en: ["Today's crypto headlines", 'A digest of what actually moved, once every 24 hours.'],
    ar: ['عناوين اليوم', 'ملخص لما تحرك فعلاً كل ٢٤ ساعة.']
  },
  promo4: {
    fa: ['کیف پولت را پشتیبان گرفتی؟', 'بدون ۱۲ کلمه روی کاغذ، هیچ راهی برای برگرداندن دارایی وجود ندارد.'],
    en: ['Have you backed up your wallet?', 'Without those 12 words on paper there is no way back into your funds.'],
    ar: ['هل نسخت محفظتك احتياطياً؟', 'بدون الكلمات الـ١٢ على ورق لا سبيل لاستعادة أموالك.']
  },
  promo5: {
    fa: ['یاد بگیر، بعد ریسک کن', 'بخش آموزش با اعتبار مجازی — بدون اینکه یک ریال واقعی درگیر شود.'],
    en: ['Learn first, risk later', 'The learning modules run on virtual credits — not a single real coin at risk.'],
    ar: ['تعلّم أولاً', 'وحدات التعلم تعمل برصيد افتراضي بالكامل.']
  },
  promo6: {
    fa: ['بیش از ۱۰۰۰ توکن قابل سواپ', 'جستجو کن، توکن جدید را با آدرس قرارداد اضافه کن، همان‌جا سواپ کن.'],
    en: ['1,000+ tokens to swap', 'Search it, import brand-new tokens by address, swap on the spot.'],
    ar: ['أكثر من ١٠٠٠ عملة', 'ابحث واستورد بالعنوان وبادل فوراً.']
  },
  promo7: {
    fa: ['کارمزد شفاف', '۰.۵٪ کارمزد پلتفرم، قبل از امضا نمایش داده می‌شود. گس جداست و به شبکه می‌رود.'],
    en: ['Transparent fees', '0.5% platform fee, shown before you sign. Gas is separate and goes to the network.'],
    ar: ['رسوم شفافة', '٠٫٥٪ رسوم المنصة تُعرض قبل التوقيع.']
  }
};

const KEYS = Object.keys(PROMOS);

export function promoForToday(date = new Date()) {
  return KEYS[Math.floor(date.getTime() / 86400000) % KEYS.length];
}

/** Send today's promotional notification to every subscriber. */
export function sendDailyPromo() {
  const key = promoForToday();
  return broadcast(
    (lang) => {
      const [title, body] = PROMOS[key][lang] ?? PROMOS[key].en;
      return { title, body, url: '/' };
    },
    { tag: 'fbt-daily' }
  );
}
