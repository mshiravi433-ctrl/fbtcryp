import { Telegraf } from 'telegraf';
import { withCache } from './cache.js';
import { fetchGlobal, fetchMarkets, fetchTrending } from './providers.js';
import {
  NETWORK_COUNT,
  TELEGRAM_MESSAGE_LIMIT,
  findTopic,
  helpResponse,
  helpTopicsKeyboard,
  topicIdFromCallback,
  topicMessage
} from './botHelp.js';

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

function launchButtonRow(webAppUrl, startPayload = '') {
  const url = webAppUrlForStart(webAppUrl, startPayload);
  return url ? [[{ text: '🚀 Open FBT SWAP', web_app: { url } }]] : [];
}

function launchKeyboard(webAppUrl, startPayload = '') {
  const rows = launchButtonRow(webAppUrl, startPayload);
  return rows.length ? { reply_markup: { inline_keyboard: rows } } : undefined;
}

/**
 * The help index keyboard: the launch button first (it is what most people
 * came for), then one button per help topic.
 *
 * WEBAPP_URL may be unset on a bare local instance — in that case the help
 * buttons must still render, because a help screen that disappears whenever a
 * deployment variable is missing is exactly the help nobody can get.
 */
function helpKeyboard(webAppUrl) {
  const inline_keyboard = [...launchButtonRow(webAppUrl), ...helpTopicsKeyboard()];
  return inline_keyboard.length ? { reply_markup: { inline_keyboard } } : undefined;
}

/**
 * Telegram refuses a sendMessage body over 4096 characters with a 400, and a
 * 400 here reads to the user as "the bot ignored me". Every help topic is well
 * under the limit today; this guard exists so that adding a paragraph later
 * degrades into a truncated answer plus a pointer, never into silence.
 */
function fitTelegramMessage(text) {
  const value = String(text ?? '');
  if (value.length <= TELEGRAM_MESSAGE_LIMIT) return value;
  const tail = '…\n\n<i>Trimmed to fit Telegram. Send /help for the rest.</i>';
  return `${value.slice(0, TELEGRAM_MESSAGE_LIMIT - tail.length)}${tail}`;
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

/**
 * The command menu, as data.
 *
 * Exported because two different processes have to publish the SAME list: the
 * long-polling dev server and the serverless webhook. A second hand-written
 * copy would drift, and the menu is the only documentation a user sees before
 * they type anything.
 */
export const BOT_COMMANDS = [
  { command: 'app', description: 'Open the FBT Swap Mini App' },
  { command: 'help', description: 'Help center: fees, wallets, safety, troubleshooting' },
  { command: 'fees', description: 'What a swap costs, and why gas is separate' },
  { command: 'networks', description: 'Supported networks and how tokens are listed' },
  { command: 'security', description: 'Safety rules and how to spot a scam' },
  { command: 'guide', description: 'Developer guide for the Mini App and API' },
  { command: 'api', description: 'API reference and authentication quick start' },
  { command: 'support', description: 'Reach a human, and what to include' },
  { command: 'price', description: 'Look up a coin price, for example /price btc' },
  { command: 'top', description: 'Show the top 10 coins by market cap' },
  { command: 'trending', description: 'Show trending coins' },
  { command: 'global', description: 'Show the global crypto market snapshot' }
];

/**
 * Build the bot and register every handler — WITHOUT connecting to Telegram.
 *
 * Split out from startBot() because the handlers now have two homes:
 *
 *   · server/index.js keeps a long-polling process open (local, self-hosted);
 *   · server/app.js serves them from a webhook route (Vercel, where no
 *     process survives between requests, so polling is impossible).
 *
 * Nothing here performs I/O, which is what makes it safe to call at module
 * scope in a serverless function: a cold start must not depend on an outbound
 * call to api.telegram.org succeeding.
 */
export function buildBot({ token, webAppUrl }) {
  const bot = new Telegraf(token);
  registerHandlers(bot, { webAppUrl });
  return bot;
}

export async function startBot({ token, webAppUrl }) {
  const bot = new Telegraf(token);

  /*
   * The command menu is English-only on purpose: it is the developer-facing
   * surface of the product, while the Mini App itself is translated into
   * twelve languages. Descriptions say what the command DOES rather than
   * naming it twice ("Help — help"), because this list is the only
   * documentation a user sees before they type anything.
   */
  await bot.telegram.setMyCommands(BOT_COMMANDS)
    .catch((err) => console.warn('setMyCommands failed:', err?.message ?? err));

  registerHandlers(bot, { webAppUrl });

  await bot.launch();
  console.log('▸ Telegram bot started (long polling)');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}

/**
 * Register every handler on a Telegraf instance.
 *
 * Pure wiring, no I/O: identical behaviour whether the updates arrive by long
 * polling or by webhook, so the deployed bot cannot answer differently from
 * the one tested locally.
 */
function registerHandlers(bot, { webAppUrl }) {
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
        /* The network count comes from the same constant the help topics use.
           It said "10" here long after the app reached seventeen chains —
           a launcher that undercounts its own coverage is a small lie, but it
           is the first sentence a new user reads. */
        `Live market data and a non-custodial swap across ${NETWORK_COUNT} networks — you hold your own keys, and you sign every trade yourself.${referral}\n\n` +
        `<i>⚠️ Swaps move real funds and on-chain transactions cannot be reversed. This bot never takes deposits, never holds your keys, and will never ask you to send crypto anywhere.</i>\n\n` +
        `New here? /help explains fees, wallets, safety and what to do when something fails.\n` +
        `Developer quick start: /guide and /api\n` +
        `Commands: /app /help /fees /networks /security /price /top /global /trending`,
      launchKeyboard(webAppUrl, referralCode)
    );
  });

  /*
   * ─── THE HELP CENTER ──────────────────────────────────────────────────────
   * /help used to print eight command names. That answers "what can I type"
   * and none of the questions people actually arrive with: what this costs,
   * whether it holds their coins, why their balance vanished (wrong network),
   * or who to write to. The text now lives in server/botHelp.js as data, so a
   * topic reached from a button, a slash command or a typed keyword is the
   * SAME text — one sentence to fix when a fact changes, not four copies
   * drifting apart.
   */
  const sendHelp = (ctx, query = '') => {
    const { text } = helpResponse(query);
    return ctx.replyWithHTML(fitTelegramMessage(text), helpKeyboard(webAppUrl));
  };

  // `bot.help()` only matches a bare /help, so the argument form is handled
  // explicitly — `/help fees` must open the fee topic, not the index.
  bot.command('help', (ctx) => {
    const query = ctx.message.text.split(/\s+/).slice(1).join(' ');
    return sendHelp(ctx, query);
  });

  /* Direct routes to the topics people ask for most, so the answer is one tap
     away instead of two. Each is the same data, never a second copy. */
  for (const [command, topic] of [
    ['fees', 'fees'],
    ['networks', 'networks'],
    ['security', 'security'],
    ['support', 'support'],
    ['wallet', 'wallet'],
    ['troubleshooting', 'troubleshooting'],
    ['privacy', 'privacy']
  ]) {
    bot.command(command, (ctx) => ctx.replyWithHTML(fitTelegramMessage(topicMessage(topic)), helpKeyboard(webAppUrl)));
  }

  /*
   * Help buttons. Only `help:<known id>` is accepted and the id is looked up
   * in the topic table — callback_data arrives from the client, so it is never
   * interpolated into a reply. An unknown payload is answered (Telegram shows
   * a spinner on the button until it is) and otherwise ignored.
   */
  bot.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery?.data ?? '';
    const topicId = topicIdFromCallback(data);
    if (!topicId) {
      if (data.startsWith('help:')) await ctx.answerCbQuery('That topic no longer exists.').catch(() => {});
      return typeof next === 'function' ? next() : undefined;
    }
    await ctx.answerCbQuery().catch(() => {});
    /* A new message rather than an edit: the user keeps the index above and
       can open a second topic without losing the first. */
    await ctx.replyWithHTML(fitTelegramMessage(topicMessage(topicId)), helpKeyboard(webAppUrl));
  });

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

  /*
   * ─── A TYPED QUESTION, IN A PRIVATE CHAT ONLY ─────────────────────────────
   * People do not read a command list before asking; they type "what are the
   * fees" or "my balance is gone". Matching that against the same topic table
   * turns a message the bot used to ignore into the exact answer.
   *
   * Two deliberate limits:
   *
   *  · PRIVATE CHATS ONLY. In a group, replying to any message containing the
   *    word "wallet" would be spam, and a bot that spams gets removed. Groups
   *    still get commands, help buttons and inline queries.
   *
   *  · NO GUESSING. findTopic() returns null unless the match is real. An
   *    unrecognised message gets one short pointer to /help, not a confident
   *    answer to a question nobody asked — the worst failure mode for help
   *    text about money.
   *
   * The user's text is never echoed back, so nothing they type can reach the
   * HTML reply at all.
   */
  bot.on('text', async (ctx) => {
    if (ctx.chat?.type !== 'private') return;
    const text = String(ctx.message?.text ?? '').trim();
    if (!text || text.startsWith('/')) return;

    const topic = findTopic(text);
    if (topic) {
      await ctx.replyWithHTML(fitTelegramMessage(topicMessage(topic.id)), helpKeyboard(webAppUrl));
      return;
    }
    await ctx.replyWithHTML(
      `I only answer commands and help topics — I am not a chat assistant, and I will not guess about your money.\n\n` +
        `Send /help for the topic list, <code>/price btc</code> for a price, or /support to reach a human.`,
      helpKeyboard(webAppUrl)
    );
  });

  /*
   * A handler that throws must not take the process (or the serverless
   * invocation) down with it. Telegraf routes every handler rejection here.
   */
  bot.catch((err) => console.error('bot error:', err?.message ?? err));

  return bot;
}
