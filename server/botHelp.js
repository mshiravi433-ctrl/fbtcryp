/**
 * THE BOT'S IN-CHAT HELP CENTER (English)
 * ---------------------------------------------------------------------------
 * Until now `/help` printed eight command names and nothing else. That is a
 * command list, not help: it answers "what can I type" and none of the
 * questions a person actually arrives with — what this thing costs, whether it
 * holds their coins, which networks it reaches, why a swap failed, who to
 * write to when it did.
 *
 * So the help lives here as DATA, not as string literals sprinkled through the
 * handler file:
 *
 *   • one topic = one object, so a topic can be reached from /help, from a
 *     button, from a slash command and from a typed keyword without the text
 *     being written four times and drifting three ways;
 *   • every topic is plain text plus the three inline tags Telegram's HTML
 *     parse mode actually accepts (<b>, <i>, <code>) — an unescaped stray `<`
 *     or `&` makes Telegram reject the whole sendMessage with 400, which is
 *     how a help screen becomes silence;
 *   • nothing here is generated from user input, so nothing here can carry an
 *     injection into a reply.
 *
 * ─── WHAT THIS FILE IS NOT ALLOWED TO SAY ───────────────────────────────────
 * The bot once told new users "everything runs on virtual NX credits" while
 * handing them a button into a real exchange (see the regression test in
 * test/units.mjs). Help text is read by exactly the people who do not yet know
 * what is real, so the same rules bind every string below:
 *
 *   • never imply funds are simulated, insured, guaranteed or reversible;
 *   • never promise a return, a yield or a profit;
 *   • never ask for a seed phrase, a private key or a deposit — and say so
 *     out loud, because that sentence is the user's defence against someone
 *     impersonating this bot.
 *
 * English only, by request: this is the developer-facing surface of the bot.
 * The Mini App itself is translated into twelve languages.
 */

/** Telegram rejects a sendMessage body longer than this. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/** Telegram rejects callback_data longer than this, in BYTES. */
export const CALLBACK_DATA_LIMIT = 64;

/** Prefix for every help button's callback_data: `help:<topic id>`. */
export const HELP_CALLBACK_PREFIX = 'help:';

/*
 * Facts repeated across topics. A number that appears in two answers must come
 * from one constant, otherwise the day the fee changes the bot starts quoting
 * two different prices — and the wrong one is still said with total confidence.
 */
export const FEE_PERCENT = '0.70%';
export const NETWORK_COUNT = 17;
const NETWORK_LIST =
  'BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche, Linea, ' +
  'Sonic, Mantle, Berachain, Unichain, Monad, Scroll, zkSync Era, Robinhood Chain and Solana';
const SITE = 'https://fbtswap.ir';
const SUPPORT_EMAIL = 'fbtswap@gmail.com';

/**
 * Every help topic.
 *
 * `id`       — stable, used in callback_data and in `/help <id>`; keep short.
 * `title`    — button label and heading.
 * `summary`  — one line, shown in the /help index.
 * `keywords` — what a user might type instead of the id.
 * `body`     — the answer. Telegram HTML: only <b>, <i>, <code> and newlines.
 */
export const HELP_TOPICS = [
  {
    id: 'start',
    title: '🚀 Getting started',
    summary: 'What FBT Swap is and the first four steps.',
    keywords: ['start', 'begin', 'getting started', 'first', 'intro', 'new', 'how to use', 'basics'],
    body:
      `<b>Getting started</b>\n\n` +
      `FBT Swap is a non-custodial exchange interface. You keep your own wallet, you sign every transaction yourself, and the app never holds your coins or your recovery phrase.\n\n` +
      `<b>1. Open the app</b>\n` +
      `Send /app, or use the Menu Button in this chat. The web version is ${SITE} and there is an Android build too.\n\n` +
      `<b>2. Connect a wallet</b>\n` +
      `MetaMask, Trust, any WalletConnect wallet, Phantom or Solflare for Solana. Connecting shares only your public address — it grants nobody permission to move funds.\n\n` +
      `<b>3. Fund that wallet, not this bot</b>\n` +
      `There is no deposit button anywhere and that is deliberate. Send coins to your own address, on the right network, and keep a little of the network's native coin for gas.\n\n` +
      `<b>4. Swap</b>\n` +
      `Pick the two tokens, read the quote — rate, ${FEE_PERCENT} platform fee, price impact, minimum received — then sign in your wallet.\n\n` +
      `Next: /help wallet · /help fees · /help security`
  },
  {
    id: 'commands',
    title: '⌨️ All commands',
    summary: 'Every command this bot answers.',
    keywords: ['commands', 'command', 'list', 'menu', 'slash'],
    body:
      `<b>All commands</b>\n\n` +
      `<b>App and help</b>\n` +
      `/start — welcome message and the launch button\n` +
      `/app — open the Mini App\n` +
      `/help — this help center; <code>/help fees</code> opens one topic\n` +
      `/guide — developer guide for the Mini App\n` +
      `/api — API reference and authentication\n` +
      `/support — how to reach a human\n\n` +
      `<b>Topic shortcuts</b>\n` +
      `/fees — what a swap costs\n` +
      `/networks — supported chains\n` +
      `/security — safety rules and scam defence\n\n` +
      `<b>Market data</b>\n` +
      `/price <code>btc</code> — price, 1h/24h/7d change, cap, volume\n` +
      `/top — top 10 by market cap\n` +
      `/trending — what is trending now\n` +
      `/global — total cap, volume, BTC and ETH dominance\n\n` +
      `<b>Inline</b>\n` +
      `Type <code>@fbtco_bot btc</code> in any chat to share a price card.\n\n` +
      `No command here moves money, takes a deposit or places an order for you.`
  },
  {
    id: 'swap',
    title: '🔁 Swapping',
    summary: 'How a swap is quoted, signed and confirmed.',
    keywords: ['swap', 'trade', 'exchange', 'quote', 'slippage', 'approve', 'approval'],
    body:
      `<b>Swapping</b>\n\n` +
      `<b>How a trade happens</b>\n` +
      `The app asks DEX aggregators for a route, shows you the best executable quote, and builds a transaction. Your wallet signs it. The app never signs for you and cannot move funds on its own.\n\n` +
      `<b>Read these four lines before signing</b>\n` +
      `· Rate and the amount you receive\n` +
      `· Platform fee — ${FEE_PERCENT} of the input on supported routes\n` +
      `· Price impact — a large trade in a thin pool moves the price against you\n` +
      `· Minimum received — your slippage limit; below it the trade reverts instead of filling badly\n\n` +
      `<b>Approvals</b>\n` +
      `An ERC-20 swap needs a one-time approval transaction before the swap itself, so you may sign twice. Approve the amount you are trading, not an unlimited allowance, unless you understand the trade-off.\n\n` +
      `<b>When it fails</b>\n` +
      `A reverted swap usually means slippage was exceeded, gas ran out, or the route expired. The gas is spent but the tokens stayed with you. Re-quote and try again — see /help troubleshooting.\n\n` +
      `<i>On-chain transactions cannot be reversed, and nothing here is financial advice.</i>`
  },
  {
    id: 'fees',
    title: '💸 Fees and gas',
    summary: `The ${FEE_PERCENT} platform fee, and why gas is separate.`,
    keywords: ['fee', 'fees', 'cost', 'costs', 'swap cost', 'how much', 'charge', 'charges', 'commission', 'gas', 'cheap', 'expensive'],
    body:
      `<b>Fees and gas</b>\n\n` +
      `<b>Platform fee — ${FEE_PERCENT}</b>\n` +
      `Charged on the input amount of a swap on supported routes, and always shown in the quote before you sign. Nothing is charged for opening the app, connecting a wallet, or reading prices.\n\n` +
      `<b>Network gas — separate, and not ours</b>\n` +
      `Gas is paid to the network in its own native coin: BNB on BNB Chain, ETH on Ethereum or Arbitrum or Base, POL on Polygon, SOL on Solana. It never comes out of the platform fee, and no part of it reaches us. Keep a small balance of the native coin or your tokens will be stuck where they are.\n\n` +
      `<b>What that means in practice</b>\n` +
      `A failed transaction still costs gas, because the network did the work either way. Cheap chains cost cents; Ethereum mainnet at a busy hour can cost more than a small trade is worth — check before you sign.\n\n` +
      `<b>Bridges and third parties</b>\n` +
      `A cross-chain route also pays the bridge or solver its own fee, quoted separately in that flow. See /help bridge.`
  },
  {
    id: 'networks',
    title: '🌐 Networks and tokens',
    summary: `The ${NETWORK_COUNT} supported chains and how tokens are listed.`,
    keywords: ['network', 'networks', 'chain', 'chains', 'token', 'tokens', 'contract', 'evm', 'solana'],
    body:
      `<b>Networks and tokens</b>\n\n` +
      `<b>${NETWORK_COUNT} networks</b>\n` +
      `${NETWORK_LIST}.\n\n` +
      `<b>Tokens</b>\n` +
      `Public token lists give thousands of assets per chain. Around ninety hand-checked tokens are bundled so the app still works offline, and any other token can be imported by pasting its contract address.\n\n` +
      `<b>The one rule that matters</b>\n` +
      `A token symbol is not unique. Anyone can deploy a contract called USDT. Before importing, verify the contract address against the project's own documentation or the chain explorer — a single wrong character is a different token, usually a worthless clone.\n\n` +
      `<b>Networks are separate worlds</b>\n` +
      `The same address exists on every EVM chain, but the balances do not travel between them. Sending on the wrong network can lose the funds permanently. Moving value between chains needs a bridge — /help bridge.`
  },
  {
    id: 'wallet',
    title: '👛 Wallets',
    summary: 'Connecting, funding, and what non-custodial really means.',
    keywords: ['wallet', 'connect', 'metamask', 'trust', 'walletconnect', 'phantom', 'seed', 'recovery', 'deposit', 'withdraw'],
    body:
      `<b>Wallets</b>\n\n` +
      `<b>Non-custodial, literally</b>\n` +
      `Your keys stay in your wallet. We cannot move your funds, freeze them, reverse a transaction, or recover them for you. That is the trade: nobody can take your coins, and nobody can rescue you either.\n\n` +
      `<b>Supported</b>\n` +
      `MetaMask, Trust Wallet and any WalletConnect v2 wallet on EVM chains; Phantom, Solflare and Backpack on Solana; plus the in-app wallet.\n\n` +
      `<b>There is no deposit and no withdrawal</b>\n` +
      `Because there is no account holding your money. You fund your own wallet from wherever you already hold coins, on the correct network, and the balance simply appears when you connect.\n\n` +
      `<b>Your recovery phrase</b>\n` +
      `Twelve or twenty-four words that ARE the wallet. Written on paper, never in a photo, a chat or a cloud note. This bot, the app, and every honest support person will never ask for it. Anyone who does is stealing from you — no exceptions, no matter what they claim is wrong with your account.`
  },
  {
    id: 'bridge',
    title: '🌉 Bridging between chains',
    summary: 'Moving value across networks, and the extra risk.',
    keywords: ['bridge', 'cross chain', 'crosschain', 'transfer', 'move', 'between chains'],
    body:
      `<b>Bridging between chains</b>\n\n` +
      `A swap happens inside one network. Moving value from one chain to another is a different operation with different failure modes, so the app treats it as its own flow instead of hiding it inside a swap.\n\n` +
      `<b>What to expect</b>\n` +
      `· Two networks, two gas balances — you need the native coin on the source chain, and usually a little on the destination before you can do anything there.\n` +
      `· A bridge or solver fee on top of the swap economics, quoted before you sign.\n` +
      `· Minutes, not seconds. A pending bridge is normal; watch the transaction on both explorers rather than resubmitting.\n\n` +
      `<b>The honest caveat</b>\n` +
      `Bridges are third-party infrastructure and have historically been the most attacked part of this industry. Bridge amounts you can afford to have delayed, and prefer well-known routes for large sums.`
  },
  {
    id: 'security',
    title: '🛡 Safety and scams',
    summary: 'The rules that keep your funds yours.',
    keywords: ['security', 'safe', 'safety', 'scam', 'phishing', 'fake', 'hack', 'support scam', 'risk'],
    body:
      `<b>Safety and scams</b>\n\n` +
      `<b>Non-negotiable rules</b>\n` +
      `· Nobody legitimate ever needs your recovery phrase or private key. Nobody. Not support, not an admin, not this bot.\n` +
      `· We never take deposits and will never ask you to send crypto anywhere to unlock, verify, upgrade or rescue anything.\n` +
      `· There is no giveaway, no doubling, no guaranteed return, and no account that needs topping up.\n\n` +
      `<b>Check you are in the right place</b>\n` +
      `The official bot is <code>@fbtco_bot</code>. Open the Mini App from the Menu Button in THIS chat — a link copied from another bot or channel can point anywhere, and a cloned interface looks identical. The official website is ${SITE}.\n\n` +
      `<b>Before you sign anything</b>\n` +
      `Read what the wallet is actually asking. An unlimited approval to an unknown contract can drain a token later, long after the screen that asked for it is closed. Revoke approvals you no longer need.\n\n` +
      `<b>Reality check</b>\n` +
      `Crypto is volatile, on-chain transactions are irreversible, and you can lose everything. Nothing this bot or app says is financial advice.`
  },
  {
    id: 'developers',
    title: '🧑‍💻 Developers',
    summary: 'Projects, API keys and listings inside the Mini App.',
    keywords: ['developer', 'developers', 'project', 'api key', 'apikey', 'agent', 'strategy', 'listing', 'sdk'],
    body:
      `<b>Developers</b>\n\n` +
      `Open the Mini App and go to the Developers page. From there you can:\n\n` +
      `· create a project and generate an API key — it is shown once and never again, so store it immediately;\n` +
      `· publish agent and strategy listings to the ecosystem registry;\n` +
      `· inspect certification and reputation data behind a listing's badge.\n\n` +
      `<b>Keys are secrets</b>\n` +
      `An API key belongs on your server, never in a mobile build, a public repository or a browser bundle. Anything shipped to a client is readable by everyone who installs it.\n\n` +
      `<b>Endpoints and auth</b>\n` +
      `Send /api for the base URL, the initData authentication contract, the main endpoints, rate limits and the OpenAPI schema. /guide covers setup and the usual Mini App login failures.`
  },
  {
    id: 'troubleshooting',
    title: '🩺 Troubleshooting',
    summary: 'Login errors, missing balances, stuck transactions.',
    keywords: ['troubleshoot', 'troubleshooting', 'problem', 'error', 'bug', 'stuck', 'not working', 'broken', 'failed', 'pending', 'balance', 'balance is gone', 'missing balance', 'cannot see my tokens'],
    body:
      `<b>Troubleshooting</b>\n\n` +
      `<b>The Mini App will not log in / signature error</b>\n` +
      `Close the app completely and reopen it from the Menu Button in this chat, not from a copied link. If it persists, the Telegram diagnose endpoint in /api reports transport, token fingerprint and bot identity without exposing any secret.\n\n` +
      `<b>My balance is missing</b>\n` +
      `Almost always the wrong network is selected — the same address holds different balances on each chain. Switch networks, then pull to refresh. An imported token also needs the correct contract address.\n\n` +
      `<b>The swap failed</b>\n` +
      `Slippage exceeded, gas too low, or an expired route. The gas was spent, the tokens were not. Re-quote, raise slippage slightly for a volatile pair, and check you still hold enough native coin for gas.\n\n` +
      `<b>The transaction is pending forever</b>\n` +
      `Look it up on the chain explorer first — the app only reports what the network says. A stuck transaction is resolved in your wallet by speeding it up or cancelling it, never by sending funds to anyone.\n\n` +
      `<b>Prices are not loading</b>\n` +
      `A market data provider is rate-limiting or unreachable. Wait a minute and retry; your funds are unaffected because balances come from the chain, not from that provider.\n\n` +
      `Still stuck? /support`
  },
  {
    id: 'privacy',
    title: '🔒 Privacy',
    summary: 'What the bot sees and what it keeps.',
    keywords: ['privacy', 'data', 'gdpr', 'tracking', 'kyc', 'store', 'personal'],
    body:
      `<b>Privacy</b>\n\n` +
      `<b>In this chat</b>\n` +
      `Telegram gives the bot your user id, your public name and the text of the commands you send. That is what any bot receives. Referral codes in a /start link are validated against a strict pattern and used only for attribution.\n\n` +
      `<b>In the Mini App</b>\n` +
      `Telegram signs a short session payload the server verifies; a signed session identifies your Telegram account, not your identity. Wallet addresses are public chain data. There is no KYC here, because there is no custody here.\n\n` +
      `<b>What we do not have</b>\n` +
      `No private keys, no recovery phrases, no custody of funds, and no ability to move anything on your behalf. Market data and quotes come from third-party providers with their own privacy policies.`
  },
  {
    id: 'support',
    title: '📮 Support',
    summary: 'How to reach a human, and what to send.',
    keywords: ['support', 'contact', 'help me', 'human', 'email', 'report'],
    body:
      `<b>Support</b>\n\n` +
      `Email <code>${SUPPORT_EMAIL}</code> — Fanous Bazaar Pishgam, Isfahan, Khomeyni Shahr.\n\n` +
      `<b>Include this and you will get a real answer first time</b>\n` +
      `· what you were doing, and what happened instead\n` +
      `· the network and the two tokens\n` +
      `· the transaction hash, if one exists\n` +
      `· the exact error text, and whether you used Telegram, the web app or Android\n\n` +
      `<b>Never include</b>\n` +
      `Your recovery phrase, your private key, or a screenshot showing either. Support cannot use them and cannot ask for them. A transaction hash and a wallet address are public and perfectly safe to share.\n\n` +
      `<b>Before you write</b>\n` +
      `/help troubleshooting solves most reports in under a minute.`
  }
];

/** Topic ids, in display order. */
export const TOPIC_IDS = HELP_TOPICS.map((topic) => topic.id);

const BY_ID = new Map(HELP_TOPICS.map((topic) => [topic.id, topic]));

const normalize = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/^\//, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** True when `keyword` appears in `haystack` on word boundaries, not inside a
 *  longer word — otherwise "start" matches "restart" and "fee" matches
 *  "coffee", and the bot answers a question that was never asked. */
function containsPhrase(haystack, keyword) {
  const padded = ` ${haystack} `;
  return padded.includes(` ${keyword} `);
}

/**
 * Resolve whatever the user typed to a topic.
 *
 * Four passes, strictest first, so a short query can never be hijacked by a
 * longer topic that merely mentions the same word:
 *
 *   1. the exact topic id           — `/help fees`
 *   2. an exact keyword             — `/help gas`
 *   3. a prefix of either           — `/help network`, `/help trouble`
 *   4. a whole-word keyword inside a sentence — "what are the fees?"
 *
 * Pass 4 is the one that makes typed questions work, and the one that must not
 * guess. It scores every topic by the LONGEST keyword it matched (a two-word
 * phrase like "recovery phrase" is far stronger evidence than "fee") and
 * returns a winner only when there is a single best topic. A tie means the
 * sentence genuinely pointed at two subjects, and the index — which lists all
 * of them — is the honest answer.
 */
export function findTopic(query) {
  const q = normalize(query);
  if (!q) return null;

  const byId = BY_ID.get(q);
  if (byId) return byId;

  for (const topic of HELP_TOPICS) {
    if (topic.keywords.some((keyword) => normalize(keyword) === q)) return topic;
  }
  if (q.length >= 3) {
    for (const topic of HELP_TOPICS) {
      if (topic.id.startsWith(q)) return topic;
      if (topic.keywords.some((keyword) => normalize(keyword).startsWith(q))) return topic;
    }
  }

  let best = null;
  let bestScore = 0;
  let tied = false;
  for (const topic of HELP_TOPICS) {
    let score = 0;
    for (const keyword of [topic.id, ...topic.keywords]) {
      const k = normalize(keyword);
      /* Two letters is noise ("i", "do", "no"); three is the shortest term
         worth matching on and every real keyword here clears it. */
      if (k.length < 3) continue;
      if (containsPhrase(q, k)) score = Math.max(score, k.length);
    }
    if (score > bestScore) {
      bestScore = score;
      best = topic;
      tied = false;
    } else if (score > 0 && score === bestScore) {
      tied = true;
    }
  }
  return bestScore > 0 && !tied ? best : null;
}

/** A topic by exact id, or null. Used by the button handler. */
export function topicById(id) {
  return BY_ID.get(String(id ?? '').trim()) ?? null;
}

/** `help:<id>` for a button, or null when the id is unknown. */
export function callbackDataFor(id) {
  const topic = topicById(id);
  return topic ? `${HELP_CALLBACK_PREFIX}${topic.id}` : null;
}

/** The topic id carried by a button press, or null if this is not ours. */
export function topicIdFromCallback(data) {
  const value = String(data ?? '');
  if (!value.startsWith(HELP_CALLBACK_PREFIX)) return null;
  const id = value.slice(HELP_CALLBACK_PREFIX.length);
  return BY_ID.has(id) ? id : null;
}

/**
 * Inline keyboard of topic buttons, two per row, optionally preceded by the
 * launch button the rest of the bot already uses.
 */
export function helpTopicsKeyboard({ perRow = 2 } = {}) {
  const rows = [];
  for (let i = 0; i < HELP_TOPICS.length; i += perRow) {
    rows.push(
      HELP_TOPICS.slice(i, i + perRow).map((topic) => ({
        text: topic.title,
        callback_data: `${HELP_CALLBACK_PREFIX}${topic.id}`
      }))
    );
  }
  return rows;
}

/** The /help landing message: what the bot is, then every topic with a line. */
export function helpIndexMessage() {
  const lines = HELP_TOPICS.map((topic) => `${topic.title}\n<code>/help ${topic.id}</code> — ${topic.summary}`);
  return (
    `<b>FBT Swap — Help</b>\n\n` +
    `A non-custodial swap across ${NETWORK_COUNT} networks plus live market data. You hold your own keys and sign every trade yourself; this bot takes no deposits and never asks you to send crypto anywhere.\n\n` +
    `Tap a topic below, or send <code>/help &lt;topic&gt;</code> — for example <code>/help fees</code>.\n\n` +
    `${lines.join('\n\n')}\n\n` +
    `Commands: /app /guide /api /price /top /trending /global /support\n\n` +
    `<i>⚠️ Swaps move real funds and on-chain transactions cannot be reversed. Nothing here is financial advice.</i>`
  );
}

/**
 * One topic, ready to send. Unknown ids return null so the caller can fall
 * back to the index instead of sending an empty message.
 */
export function topicMessage(id) {
  const topic = topicById(id);
  if (!topic) return null;
  return `${topic.body}\n\n<i>More topics: /help</i>`;
}

/**
 * The answer to `/help`, `/help fees`, or `/help something unknown`.
 * Always returns a sendable message; `matched` says whether we understood.
 */
export function helpResponse(query = '') {
  const q = String(query ?? '').trim();
  if (!q) return { matched: true, topicId: null, text: helpIndexMessage() };

  const topic = findTopic(q);
  if (topic) return { matched: true, topicId: topic.id, text: topicMessage(topic.id) };

  return {
    matched: false,
    topicId: null,
    text:
      `I do not have a topic called <code>${escapeHtml(q).slice(0, 64)}</code>.\n\n` +
      `${helpIndexMessage()}`
  };
}

/** Escape user-supplied text before it is echoed back inside HTML. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
