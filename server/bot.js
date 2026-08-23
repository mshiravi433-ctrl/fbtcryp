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

// Keep Bot API /start payloads on the same strict shape as browser referrals.
// It prevents arbitrary Telegram message text from becoming part of an HTML
// reply or of a Web App URL.
const REFERRAL_CODE_RE = /^[A-Za-z0-9_-]{4,32}$/;
const validReferralCode = (value) => {
  const code = String(value ?? '').trim();
  return REFERRAL_CODE_RE.test(code) ? code : null;
};

/**
 * Add a verified /start referral to the Web App button. This is a useful
 * fallback for a self-hosted polling bot: t.me/bot?start=CODE opens a chat,
 * and the next tap must not lose CODE before the app loads.
 */
export function webAppUrlForStart(webAppUrl, startPayload = '') {
  if (!webAppUrl) return '';
  const code = validReferralCode(startPayload);
  if (!code) return webAppUrl;
  try {
    const url = new URL(webAppUrl);
    url.searchParams.set('ref', code);
    return url.toString();
  } catch {
    // WEBAPP_URL is operator-controlled. Preserve it unchanged rather than
    // making /start unusable because of a malformed local configuration.
    return webAppUrl;
  }
}

function launchKeyboard(webAppUrl, startPayload = '') {
  const url = webAppUrlForStart(webAppUrl, startPayload);
  return url
    ? { reply_markup: { inline_keyboard: [[{ text: '🚀 Open FBT SWAP', web_app: { url } }]] } }
    : undefined;
}

function html(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function apiBaseUrl(webAppUrl) {
  try {
    return `${new URL(webAppUrl).origin}/api`;
  } catch {
    return '/api';
  }
}

export async function startBot({ token, webAppUrl }) {
  const bot = new Telegraf(token);

  await bot.telegram.setMyCommands([
    { command: 'app', description: 'Open the FBT Swap Mini App' },
    { command: 'guide', description: 'Developer guide for the Mini App and API' },
    { command: 'api', description: 'API reference and authentication quick start' },
    { command: 'price', description: 'Look up a coin price, for example /price btc' },
    { command: 'top', description: 'Show the top 10 coins by market cap' },
    { command: 'trending', description: 'Show trending coins' },
    { command: 'global', description: 'Show the global crypto market snapshot' },
    { command: 'help', description: 'Show all bot commands' }
  ]).catch((err) => console.warn('setMyCommands failed:', err?.message ?? err));

  bot.start(async (ctx) => {
    const name = html(ctx.from?.first_name ?? 'trader');
    const referralCode = validReferralCode(ctx.startPayload);
    const referral = referralCode ? `\n🎟 Referral code: <code>${referralCode}</code>` : '';
    /*
     * ─── A FALSE SAFETY CLAIM, NOW REMOVED ────────────────────────────────
     * This used to say "Everything runs on virtual NX credits." That was true
     * when the app was only paper trading. It has not been true for a long
     * time: Swap moves real funds on ten networks, and the mini-games it
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
        `Live market data and a non-custodial swap across 10 networks — you hold your own keys, and you sign every trade yourself.${referral}\n\n` +
        `<i>⚠️ Swaps move real funds and on-chain transactions cannot be reversed. This bot never takes deposits, never holds your keys, and will never ask you to send crypto anywhere.</i>\n\n` +
        `Developer quick start: /guide and /api\n` +
        `Commands: /app /guide /api /price /top /global /trending /help`,
      launchKeyboard(webAppUrl, referralCode)
    );
  });

  bot.help((ctx) =>
    ctx.replyWithHTML(
      `<b>Commands</b>\n` +
        `/app — open the Mini App\n` +
        `/guide — developer guide and troubleshooting steps\n` +
        `/api — API reference, auth, endpoints, and limits\n` +
        `/price &lt;symbol&gt; — spot price (e.g. <code>/price btc</code>)\n` +
        `/top — top 10 by market cap\n` +
        `/trending — what's hot right now\n` +
        `/global — total market snapshot\n\n` +
        `Read /guide first, then /api, then open the app.\n\n` +
        `⚠️ Nothing here is financial advice. Crypto is volatile and you can lose everything.`,
      launchKeyboard(webAppUrl)
    )
  );

  bot.command('app', (ctx) =>
    ctx.reply(webAppUrl ? 'Tap to open 👇' : 'WEBAPP_URL is not configured on the server.', launchKeyboard(webAppUrl))
  );

  bot.command('guide', (ctx) =>
    ctx.replyWithHTML(
      `<b>Developer guide</b>\n\n` +
        `<b>1) What this bot is</b>\n` +
        `FBT Swap is a non-custodial Mini App launcher and market assistant. It never asks for seed phrases or private keys, never takes deposits, and never holds user funds.\n\n` +
        `<b>2) Open the Mini App</b>\n` +
        `Use the Menu Button in this exact bot, then tap “Open FBT SWAP”. Opening a copied link from another bot can create a signature mismatch.\n\n` +
        `<b>3) Developers page inside the Mini App</b>\n` +
        `Open Developers to create projects, generate an API key that is shown only once, and manage agent or strategy listings. Store the key immediately; the server cannot show it again.\n\n` +
        `<b>4) If login fails</b>\n` +
        `Fully close the Mini App and reopen it from this bot's Menu Button. If the signature error continues, use /api and the Telegram diagnose endpoint to inspect transport, token fingerprint, and bot identity.\n\n` +
        `<b>5) Next step</b>\n` +
        `Read /api, then open the app and continue from the Developers page.`,
      launchKeyboard(webAppUrl)
    )
  );

  bot.command('api', (ctx) => {
    const base = apiBaseUrl(webAppUrl);
    return ctx.replyWithHTML(
      `<b>FBT Swap API quick reference</b>\n\n` +
        `<b>Base URL</b>\n` +
        `<code>${html(base)}</code>\n\n` +
        `<b>Authentication</b>\n` +
        `For Telegram-protected POSTs, send the raw Mini App initData in the <code>x-telegram-init-data</code> header or in a JSON body field like <code>{"initData":"..."}</code>. Sending both is recommended because the body round-trips bytes exactly.\n\n` +
        `<b>Key endpoints</b>\n` +
        `<code>GET  /telegram/diagnose</code>\n` +
        `<code>POST /telegram/diagnose</code>\n` +
        `<code>GET  /telegram/whoami-bot</code>\n` +
        `<code>GET  /developer/projects</code>\n` +
        `<code>POST /developer/projects</code>\n` +
        `<code>GET  /ecosystem/agents</code>\n` +
        `<code>GET  /ecosystem/strategies</code>\n` +
        `<code>GET  /ecosystem/mine/agents</code>\n` +
        `<code>GET  /ecosystem/mine/strategies</code>\n` +
        `<code>POST /ecosystem/agents</code> and <code>POST /ecosystem/strategies</code> for listings.\n\n` +
        `<b>Limits</b>\n` +
        `Plan for about 120 requests per minute per user. The API answers <code>429 RATE_LIMITED</code> with <code>retry-after</code> when the window is exceeded.\n\n` +
        `<b>OpenAPI</b>\n` +
        `Schema: <code>${html(base)}/openapi.json</code>`,
      launchKeyboard(webAppUrl)
    );
  });

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
        launchKeyboard(webAppUrl)
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
      await ctx.replyWithHTML(`<b>🏆 Top 10 by market cap</b>\n\n${lines}`, launchKeyboard(webAppUrl));
    } catch {
      await ctx.reply('Could not fetch the top coins right now.');
    }
  });

  bot.command('trending', async (ctx) => {
    try {
      const { value: list } = await withCache('trending', 120000, fetchTrending);
      const lines = list.map((c, i) => `${i + 1}. <b>${c.symbol}</b> — ${c.name}`).join('\n');
      await ctx.replyWithHTML(`<b>🔥 Trending</b>\n\n${lines}`, launchKeyboard(webAppUrl));
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
        launchKeyboard(webAppUrl)
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
