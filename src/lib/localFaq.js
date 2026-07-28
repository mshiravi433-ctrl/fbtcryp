/**
 * OFFLINE ANSWER ENGINE
 * ---------------------------------------------------------------------------
 * The "ask a question" box was dead for every user, because AI needs either a
 * deployed backend or a build-time Gemini key and neither exists yet. The two
 * obvious options were both bad: leave a button that always errors, or delete a
 * feature people want.
 *
 * So there is a third: answer the questions ourselves. The overwhelming
 * majority of what users ask a crypto app is a small, stable set — what's the
 * fee, why did my swap fail, what is gas, is my money safe. Those answers do
 * not need a language model; they need to be correct and in the user's
 * language, which is exactly what our guide content already is.
 *
 * This is keyword matching over a curated FAQ, scored by how many distinct
 * terms hit. No network, no key, no cost, works offline and in the APK.
 *
 * When a real AI provider IS configured it takes priority — see aiClient.js.
 * This is the floor, not the ceiling.
 */

/**
 * Each entry lists trigger terms in Persian AND English, so it matches whatever
 * the user types regardless of interface language. `answer` is an i18n key so
 * the response comes back translated.
 */
const ENTRIES = [
  {
    id: 'fee',
    terms: ['کارمزد', 'کارمز', 'هزینه', 'فی', 'درصد', 'کمیسیون', 'fee', 'commission', 'cost', 'charge', 'percent', '0.5'],
    answer: 'faq.fee'
  },
  {
    id: 'gas',
    terms: ['گس', 'گاز', 'کارمزد شبکه', 'سوخت', 'gas', 'network fee', 'bnb for gas', 'gwei'],
    answer: 'faq.gas'
  },
  {
    id: 'swapFailed',
    terms: ['رد شد', 'ناموفق', 'خطا', 'انجام نشد', 'شکست', 'failed', 'reverted', 'error', 'rejected', 'not working'],
    answer: 'faq.swapFailed'
  },
  {
    id: 'slippage',
    terms: ['لغزش', 'اسلیپیج', 'slippage', 'price impact', 'اثر قیمت'],
    answer: 'faq.slippage'
  },
  {
    id: 'custody',
    terms: ['امن', 'امنیت', 'نگهداری', 'پول من', 'دارایی من', 'safe', 'custody', 'hold my', 'secure', 'trust'],
    answer: 'faq.custody'
  },
  {
    id: 'seed',
    terms: ['عبارت بازیابی', 'سید', 'کلمات', 'ریکاوری', 'بازیابی', 'seed', 'recovery phrase', 'mnemonic', '12 word'],
    answer: 'faq.seed'
  },
  {
    id: 'connect',
    terms: ['وصل', 'اتصال', 'کانکت', 'متصل نمیشه', 'connect', 'wallet not', 'walletconnect', 'metamask', 'trust wallet'],
    answer: 'faq.connect'
  },
  {
    id: 'balanceZero',
    terms: ['موجودی صفر', 'موجودی نشون', 'بالانس', 'صفر', 'zero balance', 'no balance', "don't see my"],
    answer: 'faq.balanceZero'
  },
  {
    id: 'network',
    terms: ['شبکه', 'چین', 'نتورک', 'ترون', 'trc', 'erc', 'bep', 'network', 'chain', 'tron', 'wrong network'],
    answer: 'faq.network'
  },
  {
    id: 'approve',
    terms: ['تایید', 'اپرو', 'approve', 'allowance', 'permission'],
    answer: 'faq.approve'
  },
  {
    id: 'pending',
    terms: ['پندینگ', 'معلق', 'گیر کرده', 'منتظر', 'pending', 'stuck', 'waiting', 'slow'],
    answer: 'faq.pending'
  },
  {
    id: 'points',
    terms: ['امتیاز', 'پوینت', 'رتبه', 'بازی', 'points', 'ranking', 'leaderboard', 'game', 'reward'],
    answer: 'faq.points'
  },
  {
    id: 'newToken',
    terms: ['توکن جدید', 'سکه جدید', 'پیدا نمیشه', 'نیست', 'new token', 'not listed', "can't find", 'missing coin', 'add token'],
    answer: 'faq.newToken'
  },
  {
    id: 'withdraw',
    terms: [
      'برداشت', 'خروج', 'نقد', 'نقد کردن', 'تبدیل به ریال', 'ریال', 'تومان', 'تومن',
      'به پول', 'فروش به ریال', 'کارت بانکی', 'withdraw', 'cash out', 'to fiat',
      'bank', 'rial', 'toman', 'sell for cash'
    ],
    answer: 'faq.withdraw'
  },
  {
    id: 'minimum',
    terms: ['حداقل', 'کمترین', 'چقدر لازم', 'minimum', 'how much do i need', 'least'],
    answer: 'faq.minimum'
  },
  {
    id: 'scam',
    terms: ['کلاهبرداری', 'اسکم', 'هک', 'دزدی', 'فیشینگ', 'scam', 'hack', 'stolen', 'phishing', 'fake'],
    answer: 'faq.scam'
  }
];

/** Normalise Persian/Arabic variants so "كارمزد" matches "کارمزد". */
function normalise(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/[ك]/g, 'ک')
    .replace(/[ۀة]/g, 'ه')
    .replace(/[\u064B-\u0652\u200c]/g, '') // diacritics + ZWNJ
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Best local answer for a question, or null when nothing matches well enough.
 *
 * Returning null matters: a confidently wrong answer about someone's money is
 * worse than "I don't know, here's how to reach a human".
 *
 * @returns {{id: string, key: string, score: number} | null}
 */
export function findLocalAnswer(question) {
  const q = normalise(question);
  if (q.length < 2) return null;

  let best = null;
  for (const entry of ENTRIES) {
    let score = 0;
    for (const term of entry.terms) {
      const t = normalise(term);
      if (!t) continue;
      if (q.includes(t)) {
        // Longer matched phrases are far more indicative than a stray word.
        score += t.length >= 6 ? 3 : t.includes(' ') ? 3 : 2;
      }
    }
    if (score > (best?.score ?? 0)) best = { id: entry.id, key: entry.answer, score };
  }

  // Below this, matches are single short coincidences rather than intent.
  return best && best.score >= 2 ? best : null;
}

export const localFaqTopics = () => ENTRIES.map((e) => e.id);
