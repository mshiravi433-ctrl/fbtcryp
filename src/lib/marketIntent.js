/**
 * Turn common market questions into honest operations on the live rows already
 * loaded by the Market screen. This is deliberately local and deterministic:
 * it does not claim to predict returns or call an LLM, and every answer is
 * backed by the feed's actual 24h change / volume / market-cap / price fields.
 */
const normalize = (value) => String(value ?? '')
  .toLowerCase()
  .replace(/[يى]/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/[\u200c\u200d]/g, '')
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[\u064B-\u065F\u0670]/g, '')
  .replace(/[^\p{L}\p{N}\s$.-]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const intents = [
  {
    key: 'mcap', sortKey: 'mcap', sortDir: 'desc',
    test: /(?:ارزش بازار|بزرگترین ارز|بزرگ‌ترین ارز|بزرگ\s*ترین ارز|مارکت.?کپ|market cap|largest|biggest coin|top coins?)/i
  },
  {
    key: 'losers', sortKey: 'change', sortDir: 'asc',
    test: /(?:بیشترین افت|بیشترین ضرر|ضررده|نزولی|بازنده|losers?|top loser|biggest drop|worst performing)/i
  },
  {
    key: 'volume', sortKey: 'volume', sortDir: 'desc',
    test: /(?:حجم|معامله.{0,8}زیاد|پرتراکنش|volume|most traded|highest (?:trading )?volume)/i
  },
  {
    key: 'gainers', sortKey: 'change', sortDir: 'desc',
    test: /(?:پرسود|سودده|بیشترین سود|بهترین ارز|بهترین رمزارز|بیشترین رشد|بالاترین رشد|صعودی|برنده|بازدهی بالا|gainers?|top gainer|highest return|best performing|best coin|best crypto)/i
  },
  {
    key: 'price', sortKey: 'price', sortDir: 'asc',
    test: /(?:ارزان.?ترین|قیمت کم|ارز با قیمت پایین|cheap(?:est)?|lowest price)/i
  }
];

export function interpretMarketQuery(value) {
  const query = normalize(value);
  if (!query) return null;
  return intents.find((intent) => intent.test.test(query)) ?? null;
}

export const MARKET_INTENT_SUGGESTIONS = [
  { key: 'gainers', query: 'پرسودترین ارزها' },
  { key: 'volume', query: 'ارزهای با بیشترین حجم' },
  { key: 'mcap', query: 'بزرگترین ارزها از نظر ارزش بازار' },
  { key: 'losers', query: 'بیشترین افت امروز' }
];
