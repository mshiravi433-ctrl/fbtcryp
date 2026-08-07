import { Telegraf } from 'telegraf';
import { withCache } from './cache.js';
import { fetchGlobal, fetchMarkets, fetchTrending } from './providers.js';

/**
 * The Telegram bot: a thin launcher for the Mini App plus a few read-only
 * market commands so the bot is useful even in a group chat.
 *
 * It deliberately has NO commands that move money, take deposits, or place
 * real orders. A bot that custodies funds is a licensed money service in most
 * jurisdictions — keep that on a separate, audited, KYC-gated backend.
 */

const fmtUsd = (v) => {
  const abs = Math.abs(v ?? 0);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1) return `$${v.toFixed(2)}`;
  return `$${(v ?? 0).toPrecision(4)}`;
};

const arrow = (v) => (v >= 0 ? '🟢' : '🔴');
const pct = (v) => `${v >= 0 ? '+' : ''}${(v ?? 0).toFixed(2)}%`;

export async function startBot({ token, webAppUrl }) {
  const bot = new Telegraf(token);

  const launchKeyboard = webAppUrl
    ? { reply_markup: { inline_keyboard: [[{ text: '🚀 Open FBT SWAP', web_app: { url: webAppUrl } }]] } }
    : undefined;

  bot.start(async (ctx) => {
    const name = ctx.from?.first_name ?? 'trader';
    const referral = ctx.startPayload ? `\n🎟 Referral code: <code>${ctx.startPayload}</code>` : '';
    /*
     * ─── A FALSE SAFETY CLAIM, NOW REMOVED ────────────────────────────────
     * This used to say "Everything runs on virtual NX credits." That was true
     * when the app was only paper trading. It has not been true for a long
     * time: Swap moves real funds on eight networks, and the mini-games it
     * referred to are compiled out of release builds entirely.
     *
     * Telling someone their first trade is play money, immediately before
     * handing them a button that opens a real exchange, is the most dangerous
     * sentence in the whole product. Somebody could reasonably have believed
     * they were practising.
     *
     * What IS still true is the part that matters and is kept: the bot takes
     * no deposits and never asks anyone to send crypto anywhere. That is the
     * scam-defence line, and it should be the last thing they read.
     */
    await ctx.replyWithHTML(
      `<b>FBT Swap</b>\n\n` +
        `Hey ${name} 👋\n` +
        `Live market data and a non-custodial swap across eight networks — you hold your own keys, and you sign every trade yourself.${referral}\n\n` +
        `<i>⚠️ Swaps move real funds and on-chain transactions cannot be reversed. This bot never takes deposits, never holds your keys, and will never ask you to send crypto anywhere.</i>\n\n` +
        `Commands: /price /top /global /trending /help`,
      launchKeyboard
    );
  });

  bot.help((ctx) =>
    ctx.replyWithHTML(
      `<b>Commands</b>\n` +
        `/app — open the mini app\n` +
        `/price &lt;symbol&gt; — spot price (e.g. <code>/price btc</code>)\n` +
        `/top — top 10 by market cap\n` +
        `/trending — what's hot right now\n` +
        `/global — total market snapshot\n\n` +
        `⚠️ Nothing here is financial advice. Crypto is volatile and you can lose everything.`,
      launchKeyboard
    )
  );

  bot.command('app', (ctx) =>
    ctx.reply(webAppUrl ? 'Tap to open 👇' : 'WEBAPP_URL is not configured on the server.', launchKeyboard)
  );

  bot.command('global', async (ctx) => {
    try {
      const { value: g } = await withCache('global', 45000, fetchGlobal);
      await ctx.replyWithHTML(
        `<b>🌐 Global market</b>\n\n` +
          `Cap: <b>${fmtUsd(g.mcap)}</b> ${arrow(g.mcapChange)} ${pct(g.mcapChange)}\n` +
          `Vol 24h: <b>${fmtUsd(g.volume)}</b>\n` +
          `BTC dominance: <b>${g.btcDominance.toFixed(2)}%</b>\n` +
          `ETH dominance: <b>${g.ethDominance.toFixed(2)}%</b>\n` +
          `Coins: ${g.coins.toLocaleString()} · Markets: ${g.markets.toLocaleString()}`,
        launchKeyboard
      );
    } catch {
      await ctx.reply('Market data is temporarily unavailable. Try again in a minute.');
    }
  });

  bot.command('top', async (ctx) => {
    try {
      const { value: coins } = await withCache('markets:usd:1:10', 30000, () => fetchMarkets({ perPage: 10 }));
      const lines = coins
        .map((c, i) => `${String(i + 1).padStart(2)}. <b>${c.symbol}</b> ${fmtUsd(c.price)} ${arrow(c.change24h)} ${pct(c.change24h)}`)
        .join('\n');
      await ctx.replyWithHTML(`<b>🏆 Top 10 by market cap</b>\n\n${lines}`, launchKeyboard);
    } catch {
      await ctx.reply('Could not fetch the top coins right now.');
    }
  });

  bot.command('trending', async (ctx) => {
    try {
      const { value: list } = await withCache('trending', 120000, fetchTrending);
      const lines = list.map((c, i) => `${i + 1}. <b>${c.symbol}</b> — ${c.name}`).join('\n');
      await ctx.replyWithHTML(`<b>🔥 Trending</b>\n\n${lines}`, launchKeyboard);
    } catch {
      await ctx.reply('Trending data is unavailable right now.');
    }
  });

  bot.command('price', async (ctx) => {
    const query = ctx.message.text.split(/\s+/).slice(1).join(' ').trim().toLowerCase();
    if (!query) return ctx.reply('Usage: /price btc');
    try {
      const { value: coins } = await withCache('markets:usd:1:250', 30000, () => fetchMarkets({ perPage: 250 }));
      const coin =
        coins.find((c) => c.symbol.toLowerCase() === query) ||
        coins.find((c) => c.id === query) ||
        coins.find((c) => c.name.toLowerCase() === query) ||
        coins.find((c) => c.symbol.toLowerCase().startsWith(query));

      if (!coin) return ctx.reply(`Couldn't find "${query}" in the top 250.`);

      return ctx.replyWithHTML(
        `<b>${coin.name} (${coin.symbol})</b>  #${coin.rank}\n\n` +
          `Price: <b>${fmtUsd(coin.price)}</b>\n` +
          `1h: ${arrow(coin.change1h)} ${pct(coin.change1h)}\n` +
          `24h: ${arrow(coin.change24h)} ${pct(coin.change24h)}\n` +
          `7d: ${arrow(coin.change7d)} ${pct(coin.change7d)}\n` +
          `Cap: ${fmtUsd(coin.mcap)} · Vol: ${fmtUsd(coin.volume)}\n\n` +
          `<i>Not financial advice.</i>`,
        launchKeyboard
      );
    } catch {
      return ctx.reply('Price lookup failed. Try again shortly.');
    }
  });

  bot.on('inline_query', async (ctx) => {
    try {
      const q = ctx.inlineQuery.query.trim().toLowerCase();
      const { value: coins } = await withCache('markets:usd:1:100', 30000, () => fetchMarkets({ perPage: 100 }));
      const matches = (q ? coins.filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) : coins).slice(0, 20);
      await ctx.answerInlineQuery(
        matches.map((c) => ({
          type: 'article',
          id: c.id,
          title: `${c.symbol} — ${fmtUsd(c.price)}`,
          description: `${c.name} · 24h ${pct(c.change24h)}`,
          thumbnail_url: c.image,
          input_message_content: {
            message_text: `<b>${c.name} (${c.symbol})</b>\nPrice: ${fmtUsd(c.price)}\n24h: ${arrow(c.change24h)} ${pct(c.change24h)}`,
            parse_mode: 'HTML'
          }
        })),
        { cache_time: 30 }
      );
    } catch {
      await ctx.answerInlineQuery([]);
    }
  });

  bot.catch((err) => console.error('bot error:', err?.message ?? err));

  await bot.launch();
  console.log('▸ Telegram bot started (long polling)');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}
