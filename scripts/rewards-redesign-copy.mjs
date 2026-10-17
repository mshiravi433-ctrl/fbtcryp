#!/usr/bin/env node
/**
 * One-off: the rewards-hub redesign copy pass.
 *   · FBT is no longer described as "not tradable" — it is described as
 *     "no price today, tradable later" (the user asked for exactly this).
 *   · the new dock chip, the new hero ladder label, the new discovery-wall
 *     strings and the twenty-one new achievement cards.
 * Idempotent — re-running only fills what is missing.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../src/i18n/locales/', import.meta.url);

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cur[parts[i]] ??= {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/** key path → { en, fa } */
const ADDITIONS = {
  /* ─── the trust strip ─────────────────────────────────────────────────── */
  'rewards.v2.loyalty.fbtTitle': {
    en: 'FBT · loyalty balance',
    fa: 'FBT · موجودی وفاداری'
  },
  'rewards.v2.loyalty.pointsTitle': {
    en: 'Points · reputation score',
    fa: 'امتیاز · امتیاز اعتباری'
  },
  'rewards.v2.loyalty.fbt': {
    en: 'FBT is a loyalty balance — not a coin. No price today; it becomes tradable later, once the token is issued.',
    fa: 'FBT یک موجودی وفاداری است — نه کوین. امروز بدون قیمت؛ بعداً و با عرضهٔ توکن، قابل معامله می‌شود.'
  },
  'rewards.v2.footerNote': {
    en: 'FBT is a loyalty balance inside this app — not a coin: no price today, tradable later once the token is issued. Points are a reputation score, not currency.',
    fa: 'FBT یک موجودی وفاداری داخل همین اپ است — نه کوین: امروز بدون قیمت، و بعد از عرضهٔ توکن قابل معامله می‌شود. امتیاز هم امتیاز اعتباری است، نه ارز.'
  },
  'rewards.fbtSub': {
    en: 'loyalty balance — tradable later, once the token is issued',
    fa: 'موجودی وفاداری — بعداً و با عرضهٔ توکن قابل معامله می‌شود'
  },
  'rewards.v2.profile.legal': {
    en: 'FBT is a loyalty balance — not a coin. No price today; tradable later, once the token is issued.',
    fa: 'FBT یک موجودی وفاداری است — نه کوین. امروز بدون قیمت؛ بعداً قابل معامله می‌شود.'
  },
  'rewards.marketInfoBody': {
    en: 'FBT is not issued yet, so nothing here is priced or traded today. The points ledger is the asset: when the token is issued, one point equals one FBT and FBT becomes tradable (see docs/FBT-TOKEN-FA.md). The moment a real market exists, FBT joins the swap router — never before, and never with invented prices.',
    fa: 'FBT هنوز منتشر نشده، پس امروز هیچ‌جا قیمت‌گذاری یا معامله نمی‌شود. دفتر امتیاز دارایی است: با عرضهٔ توکن، هر امتیاز برابر یک FBT می‌شود و FBT قابل معامله می‌شود (docs/FBT-TOKEN-FA.md). به محض ایجاد بازار واقعی، FBT به مسیر سواپ وصل می‌شود — نه زودتر، و هرگز با قیمت جعلی.'
  },
  'rewards.v2.badges.soulbound': {
    en: 'Soulbound: badges cannot be transferred, sold or traded. They are not the FBT token.',
    fa: 'soulbound: بج‌ها قابل انتقال، فروش یا معامله نیستند. آن‌ها توکن FBT نیستند.'
  },

  /* ─── the hero ────────────────────────────────────────────────────────── */
  'rewards.v2.hero.noPrice': {
    en: 'No price today · tradable later',
    fa: 'امروز بدون قیمت · بعداً قابل معامله'
  },
  'rewards.v2.hero.fbtHint': {
    en: 'FBT is a loyalty balance, not a coin. It has no price today and cannot be withdrawn or traded yet — it becomes tradable once the token is issued.',
    fa: 'FBT موجودی وفاداری است، نه کوین. امروز قیمت ندارد و قابل برداشت یا معامله نیست — پس از عرضهٔ توکن قابل معامله می‌شود.'
  },
  'rewards.v2.hero.ladder': {
    en: 'The animal ladder',
    fa: 'نردبان حیوانات'
  },

  /* ─── the dock ────────────────────────────────────────────────────────── */
  'rewards.v2.quicknavItems.missions': {
    en: 'Missions',
    fa: 'مأموریت‌ها'
  },

  /* ─── the discovery wall ──────────────────────────────────────────────── */
  'rewards.v2.badges.achievementsSub': {
    en: 'Every card is something you actually did.',
    fa: 'هر کارت یک کار واقعی است که انجام داده‌ای.'
  },
  'rewards.v2.badges.allTiers': {
    en: 'All',
    fa: 'همه'
  },

  /* ─── the game ────────────────────────────────────────────────────────── */
  'rewards.v2.focus.combo': {
    en: 'Combo',
    fa: 'کمبو'
  },
  'rewards.v2.focus.bestCombo': {
    en: 'Best combo',
    fa: 'بهترین کمبو'
  },

  /* ─── the new achievement cards ───────────────────────────────────────── */
  'rewards.v2.achievements.streak3.title': { en: 'Three Flames', fa: 'سه شعله' },
  'rewards.v2.achievements.streak3.desc': { en: 'Check in three days in a row.', fa: 'سه روز پیاپی ورود بزن.' },
  'rewards.v2.achievements.backupKey.title': { en: 'Backup Key', fa: 'کلید پشتیبان' },
  'rewards.v2.achievements.backupKey.desc': { en: 'Back up your private key.', fa: 'کلید خصوصی‌ات را پشتیبان بگیر.' },
  'rewards.v2.achievements.twoFactor.title': { en: 'Second Layer', fa: 'لایهٔ دوم' },
  'rewards.v2.achievements.twoFactor.desc': { en: 'Turn on two-factor sign-in.', fa: 'ورود دومرحله‌ای را روشن کن.' },
  'rewards.v2.achievements.rank500.title': { en: 'Silver Rung', fa: 'پلهٔ نقره' },
  'rewards.v2.achievements.rank500.desc': { en: 'Collect 500 reputation points.', fa: '۵۰۰ امتیاز اعتباری جمع کن.' },
  'rewards.v2.achievements.swaps5.title': { en: 'Five Swaps', fa: 'پنج سواپ' },
  'rewards.v2.achievements.swaps5.desc': { en: 'Make five real swaps.', fa: 'پنج سواپ واقعی انجام بده.' },
  'rewards.v2.achievements.swaps25.title': { en: 'Twenty-Five', fa: 'بیست‌وپنج سواپ' },
  'rewards.v2.achievements.swaps25.desc': { en: 'Make twenty-five real swaps.', fa: '۲۵ سواپ واقعی انجام بده.' },
  'rewards.v2.achievements.crossChain.title': { en: 'Chain Walker', fa: 'زنجیره‌پیما' },
  'rewards.v2.achievements.crossChain.desc': { en: 'Move funds across chains for real.', fa: 'یک جابه‌جایی واقعی بین زنجیره‌ها بفرست.' },
  'rewards.v2.achievements.lender.title': { en: 'The Lender', fa: 'وام‌دهنده' },
  'rewards.v2.achievements.lender.desc': { en: 'Supply to a lending pool once, for real.', fa: 'یک بار واقعی در وام‌دهی سرمایه بگذار.' },
  'rewards.v2.achievements.borrower.title': { en: 'The Borrower', fa: 'وام‌گیرنده' },
  'rewards.v2.achievements.borrower.desc': { en: 'Borrow once, for real.', fa: 'یک بار واقعی وام بگیر.' },
  'rewards.v2.achievements.rank2000.title': { en: 'Gold Rung', fa: 'پلهٔ طلا' },
  'rewards.v2.achievements.rank2000.desc': { en: 'Collect 2,000 reputation points.', fa: '۲٬۰۰۰ امتیاز اعتباری جمع کن.' },
  'rewards.v2.achievements.wheelTurn.title': { en: 'Wheel Turner', fa: 'گردونه‌گرد' },
  'rewards.v2.achievements.wheelTurn.desc': { en: 'Take your first fortune-wheel spin.', fa: 'اولین چرخش گردونه را بزن.' },
  'rewards.v2.achievements.learned.title': { en: 'Scholar', fa: 'درس‌خوان' },
  'rewards.v2.achievements.learned.desc': { en: 'Finish one lesson.', fa: 'یک درس را کامل کن.' },
  'rewards.v2.achievements.streak30.title': { en: 'Thirty Flames', fa: 'سی شعله' },
  'rewards.v2.achievements.streak30.desc': { en: 'Check in for thirty days in a row.', fa: 'سی روز پیاپی ورود بزن.' },
  'rewards.v2.achievements.referrer3.title': { en: 'Three Friends', fa: 'سه همراه' },
  'rewards.v2.achievements.referrer3.desc': { en: 'Three confirmed friends joined.', fa: 'سه دوست تأییدشده دعوت کن.' },
  'rewards.v2.achievements.curator.title': { en: 'The Curator', fa: 'موزه‌دار' },
  'rewards.v2.achievements.curator.desc': { en: 'Collect all six animal badges.', fa: 'هر شش نشان حیوان را جمع کن.' },
  'rewards.v2.achievements.goalSetter.title': { en: 'Goal Setter', fa: 'هدف‌گذار' },
  'rewards.v2.achievements.goalSetter.desc': { en: 'Create a real financial goal.', fa: 'یک هدف مالی واقعی بساز.' },
  'rewards.v2.achievements.labRat.title': { en: 'Lab Rat', fa: 'آزمایشگاه' },
  'rewards.v2.achievements.labRat.desc': { en: 'Complete a lab scenario.', fa: 'یک سناریوی آزمایشگاه را کامل کن.' },
  'rewards.v2.achievements.analyst.title': { en: 'The Analyst', fa: 'تحلیل‌گر' },
  'rewards.v2.achievements.analyst.desc': { en: 'Analyse a token on the Signals surface.', fa: 'یک توکن را تحلیل کن.' },
  'rewards.v2.achievements.rank6000.title': { en: 'Platinum Rung', fa: 'پلهٔ پلاتین' },
  'rewards.v2.achievements.rank6000.desc': { en: 'Collect 6,000 reputation points.', fa: '۶٬۰۰۰ امتیاز اعتباری جمع کن.' },
  'rewards.v2.achievements.rank15000.title': { en: 'Diamond Rung', fa: 'پلهٔ الماس' },
  'rewards.v2.achievements.rank15000.desc': { en: 'Collect 15,000 reputation points.', fa: '۱۵٬۰۰۰ امتیاز اعتباری جمع کن.' },
  'rewards.v2.achievements.referrer9.title': { en: 'Nine Friends', fa: 'نه همراه' },
  'rewards.v2.achievements.referrer9.desc': { en: 'Nine confirmed friends joined.', fa: 'نه دوست تأییدشده دعوت کن.' }
};

for (const lang of ['en', 'fa']) {
  const path = new URL(`${lang}.json`, dir);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  let touched = 0;
  for (const [key, byLang] of Object.entries(ADDITIONS)) {
    if (!byLang[lang]) continue;
    setPath(json, key, byLang[lang]);
    touched += 1;
  }
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`${lang}.json — ${touched} key(s) written`);
}
