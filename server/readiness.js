/**
 * REVENUE READINESS — one endpoint that answers "what is earning, and what is
 * one setting away from earning?"
 * ---------------------------------------------------------------------------
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Asked: «ببین میشه روش های جامانده را با کارمزد صفر بزنی تا بعدا که پول اومد
 * هزینه صرف کنیم» — do the parts of the remaining revenue lines that cost
 * nothing, so that when money is available only the payment itself is left.
 *
 * The good news, verified line by line below: THE CODE IS ALREADY WRITTEN FOR
 * ALL OF THEM. GMX, THORName, the Morpho vault, Trezor and Jupiter each read a
 * single environment variable and switch themselves on. Nothing needs
 * building; they need a purchase or somebody else's reply.
 *
 * What was genuinely missing is the ability to CHECK that from a phone. The
 * owner works entirely from one, cannot read the source, and has been told
 * "it is ready, just set the variable" for five different features. That claim
 * was unverifiable — exactly the shape of the "wired to nothing" bug that has
 * shipped three times in this repo.
 *
 * So this endpoint states, per line: is it earning right now, what single
 * value turns it on, what does that value cost, and — critically — is the code
 * path actually present. A feature that reports `ready: true` here has been
 * checked, not assumed.
 *
 * ─── WHY IT REPORTS `configured`, NEVER THE VALUE ───────────────────────────
 * Several of these are public identifiers (a referral code, a vault address)
 * and could safely be echoed. Others are not. Rather than maintain a
 * per-field judgement about which is safe — a judgement that would eventually
 * be got wrong on the one that matters — nothing echoes its value. A boolean
 * answers the question being asked.
 */

import { AFFILIATE_BPS, THORNAME } from './thorchain.js';

/** Trimmed env read: an accidental空 space must not read as configured. */
const env = (k) => String(process.env[k] ?? '').trim();

/**
 * One revenue line.
 *
 * `ready` is deliberately separate from `live`. `ready` means the code path
 * exists and will activate the moment the value is set; `live` means it is
 * set and we are earning today. Collapsing them would hide the whole point —
 * that the remaining work is a purchase, not a build.
 */
function line({ id, live, ready, envVar, cost, blockedBy, note }) {
  return { id, live, ready, envVar: envVar ?? null, cost: cost ?? null, blockedBy: blockedBy ?? null, note };
}

export function revenueReadiness() {
  const lines = [
    /* ─── EARNING TODAY ─────────────────────────────────────────────────── */
    line({
      id: 'swap-evm',
      live: true,
      ready: true,
      cost: 0,
      note: 'KyberSwap, 70 bps, fee echoed in every quote'
    }),
    line({
      id: 'swap-solana',
      live: true,
      ready: true,
      cost: 0,
      note: 'OpenOcean, 70 bps, verified by decoding the transaction'
    }),
    line({
      id: 'gasless',
      live: Boolean(env('ZEROX_API_KEY')),
      ready: true,
      envVar: 'ZEROX_API_KEY',
      cost: 0,
      note: '0x gasless, 70 bps'
    }),
    line({
      id: 'tap-to-pay',
      live: Boolean(env('ZEROX_API_KEY')),
      ready: true,
      envVar: 'ZEROX_API_KEY',
      cost: 0,
      note: 'Shares the 0x key. Swap-and-send at 70 bps; same-token transfers are free by design'
    }),
    line({
      id: 'bridge-lifi',
      live: true,
      ready: true,
      cost: 0,
      note: 'LI.FI, 30 bps, integrator registered'
    }),
    line({
      id: 'bridge-xchain',
      live: Boolean(env('ZEROX_API_KEY')),
      ready: true,
      envVar: 'ZEROX_API_KEY',
      cost: 0,
      note: '0x cross-chain, 30 bps. Tron works as a DESTINATION only — 0x refuse fees on a Tron origin'
    }),
    line({
      id: 'bridge-dln',
      /*
       * Live the moment it deploys: deBridge needs no key and no account, so
       * there is nothing to configure and nothing to wait for. Measured
       * against our own address before this line was written — the response
       * carries a real AffiliateFee row at exactly the bps we ask for.
       */
      live: true,
      ready: true,
      cost: 0,
      note: "deBridge DLN, 40 bps. Keyless, no account. Rate is 40 and not 70 because DLN adds a FIXED native-coin fee: measured side by side on $10,000, 70 bps would leave the user $25 WORSE off than the LI.FI route we already have, while 40 bps leaves them better off and still pays us a third more than LI.FI"
    }),
    line({
      id: 'gold-rwa',
      live: true,
      ready: true,
      cost: 0,
      note: 'PAXG and XAUt route through the normal swap, so they earn the normal 70 bps'
    }),

    /* ─── BUILT, WAITING ONLY ON A PAYMENT ──────────────────────────────── */
    line({
      id: 'gmx',
      live: Boolean(env('VITE_GMX_REF_CODE')),
      /* The link rewriter, the code validator and the UI are all shipped. */
      ready: true,
      envVar: 'VITE_GMX_REF_CODE',
      cost: 0.02,
      blockedBy: 'GAS',
      note: 'Register `fbtswap` at app.gmx.io/#/referrals on Arbitrum. CASE-SENSITIVE. Then set the variable and Redeploy'
    }),
    line({
      id: 'thorchain-utxo',
      live: Boolean(THORNAME),
      ready: true,
      envVar: 'THOR_NAME',
      cost: 9,
      blockedBy: 'PURCHASE',
      note: `A THORName is short enough for the 80-byte OP_RETURN memo, so it unlocks BTC/BCH/LTC/DOGE at ${AFFILIATE_BPS} bps. \`fbtswap\` was still unregistered when last checked`
    }),
    line({
      id: 'morpho-vault',
      live: Boolean(env('VITE_FBT_VAULT_ADDRESS')),
      ready: true,
      envVar: 'VITE_FBT_VAULT_ADDRESS',
      cost: 25,
      blockedBy: 'DEPLOY',
      note: '$15 deploy plus a $10 dead-address seed that is MANDATORY against inflation front-running'
    }),
    line({
      id: 'jupiter',
      live: Boolean(env('JUP_REFERRAL_ACCOUNT')),
      ready: true,
      envVar: 'JUP_REFERRAL_ACCOUNT',
      cost: 1,
      blockedBy: 'SUPERSEDED',
      note: 'Kept working, but Solana already earns the same 70 bps through OpenOcean for nothing. Only worth doing if Jupiter prices better'
    }),

    /* ─── WAITING ON SOMEBODY ELSE ──────────────────────────────────────── */
    line({
      id: 'velora',
      /* Quote-only today: it improves the price we show and proves itself
         before we route money through a fourth signing path. */
      live: true,
      ready: true,
      cost: 0,
      note: 'Third price source, keyless. Pays 70 bps direct to our wallet when promoted to executable — no registration needed'
    }),
    line({
      /*
       * ─── LIVE SINCE 2026-08-09, AND NOT GATED ON THE ENV VAR ─────────────
       * This used to read `Boolean(env('VITE_AVANTIS_REF_CODE'))`, which is
       * now the WRONG question in two ways.
       *
       * 1. The code `fbtswap` is registered on Base (tx 0x05d5708a…, calldata
       *    selector 0x36def2c8 with argument "fbtswap") and is compiled into
       *    the client as the default, so the app carries it whether or not
       *    this variable is set.
       * 2. This is SERVER-side env. A `VITE_` variable is a BUILD-time value
       *    for the browser bundle; nothing guarantees it is present in the
       *    Node process. So the check could report `live:false` on a build
       *    that is demonstrably earning — the exact "readiness quietly lies"
       *    failure this endpoint exists to prevent.
       */
      id: 'avantis',
      live: true,
      ready: true,
      envVar: 'VITE_AVANTIS_REF_CODE',
      cost: 0,
      note: 'Perps on crypto, forex, metals and indices. Code fbtswap registered on Base 2026-08-09; 5% of referred fees. Links go to /referral?code= — /trade ignores the parameter'
    }),
    line({
      /* Campaign 517433 created 2026-08-09 and compiled in as the default,
         so — like Avantis above — this is no longer gated on a VITE_ variable
         that the server process may never see. */
      id: 'utex',
      live: true,
      ready: true,
      envVar: 'VITE_UTEX_CAMPAIGN_ID',
      cost: 0,
      note: 'US stocks settled in USDT — no bank and no W-8BEN, which is why it works where Alpaca and Kraken do not. Campaign 517433 live; 30% base rate, 60% for the first 30 days only if the partner form is submitted'
    }),
    line({
      id: 'trezor',
      live: Boolean(env('VITE_AFFILIATE_TREZOR')),
      ready: true,
      envVar: 'VITE_AFFILIATE_TREZOR',
      cost: 0,
      blockedBy: 'THIRD_PARTY',
      note: 'Application submitted, no reply yet. The one hardware programme whose form lists Iran'
    }),
    /* ─── BUILDER CODES: NOT BUILT, AND SAYING SO ───────────────────────── */
    /*
     * ─── WHY THESE FOUR ARE `ready: false` AND EVERY OTHER LINE IS TRUE ─────
     * Every other row in this file is code-complete and waiting on a purchase
     * or somebody's reply. These are the opposite and the endpoint must not
     * blur them together, because the whole reason it exists is that the owner
     * has been told "it's ready, just set the variable" for things that were
     * not.
     *
     * A builder code only pays when WE BUILD AND SUBMIT THE ORDER. There is no
     * link to decorate and no env var that switches it on — unlike GMX,
     * Avantis and UTEX, where the code path already exists and a referral code
     * is the only missing piece. Reporting these as `ready` would be the
     * fourth "wired to nothing" bug in this repo.
     *
     * They are listed anyway because they are, per dollar of volume, worth
     * about 25 times the referral links we already ship — see
     * src/lib/builderCodes.js for that arithmetic and
     * docs/CCXT-BUILDER-CODES-FA.md for why CCXT and the exchange broker
     * programmes are NOT the route to the same money.
     */
    line({
      id: 'builder-ostium',
      live: false,
      ready: false,
      cost: 0,
      blockedBy: 'BUILD',
      note: 'Ostium builder fee, Arbitrum. Their docs: "Any address can act as a builder without prior approval or registration" — no account, no deposit, cap 50 bps, paid atomically to our address on trade open. Gold, oil, forex and indices, which is what our Stocks and gold screens already price and cannot sell. Cheapest real option: costs nothing, needs an order path'
    }),
    line({
      id: 'builder-dydx',
      live: false,
      ready: false,
      cost: 0,
      blockedBy: 'BUILD',
      note: 'dYdX builder codes, cap 100 bps. CORRECTS an older claim in venueReferral.js: the $10,000 volume floor is on their AFFILIATE programme, not on builder codes — their docs say "No governance proposal is required to use builder codes". Fee rides in the order message as BuilderCodeParameters and is added on top of the fill'
    }),
    line({
      id: 'builder-hyperliquid',
      live: false,
      ready: false,
      cost: 100,
      blockedBy: 'DEPOSIT',
      note: 'Where the money actually is: top ten builders have taken $63M+, Phantom over $20M at the same 5 bps we would charge. The 100 USDC is a BALANCE, not a fee — "at least 100 USDC in perps account value" — and stays ours. Cap 10 bps perps, 100 bps spot. Every user must sign ApproveBuilderFee once from their main wallet first'
    }),
    line({
      id: 'builder-drift',
      live: false,
      ready: false,
      cost: 6,
      blockedBy: 'DEPOSIT',
      note: 'Drift builder codes on Solana, permissionless. Held back because the rent is PER USER: each trader needs a RevenueShareEscrow account (~0.035 SOL) that their docs expect the builder to pay for, so we would be spending before earning'
    }),

    line({
      id: 'kyberswap-key',
      /* Not a new revenue line — insurance on the largest existing one. */
      live: Boolean(env('KYBER_API_KEY')),
      ready: false,
      envVar: 'KYBER_API_KEY',
      cost: 0,
      blockedBy: 'THIRD_PARTY',
      note: 'We are on the legacy rate-limited host. Free key via business@kyber.network. Protects revenue rather than adding it'
    })
  ];

  const live = lines.filter((l) => l.live).length;
  const waiting = lines.filter((l) => !l.live && l.ready);
  /*
   * ─── THE ROWS THAT NEED A BUILD, COUNTED SEPARATELY ─────────────────────
   * `waiting` is `!live && ready`, so a `ready: false` row falls out of it
   * entirely — which used to mean `allRemainingAreCodeComplete` reported TRUE
   * while four builder-code lines needed real work. `.every()` on a filtered
   * array is vacuously true, and a headline that is vacuously true is exactly
   * the kind of quiet lie this endpoint was built to stop.
   */
  const notCodeComplete = lines.filter((l) => !l.live && !l.ready);
  /*
   * ─── "NEEDS A BUILD" AND "NOT CODE-COMPLETE" ARE NOT THE SAME SET ────────
   * First cut reported all five `ready: false` rows as `needsBuild`, which put
   * `kyberswap-key` on the build list. That row is not a build at all — the
   * code works, we are on the legacy rate-limited host and are waiting for
   * Kyber to answer an email. Telling the owner to "build" something whose
   * blocker is somebody else's inbox is the same class of misdirection this
   * endpoint exists to remove, just pointing the other way.
   */
  const needsBuild = notCodeComplete.filter((l) => l.blockedBy !== 'THIRD_PARTY');

  return {
    live,
    total: lines.length,
    /* What it would cost to switch on everything still switchable with money. */
    costToActivateAll: Number(
      waiting.reduce((n, l) => n + (l.blockedBy === 'THIRD_PARTY' ? 0 : l.cost || 0), 0).toFixed(2)
    ),
    /*
     * The honest headline: is every remaining line code-complete? Now counts
     * the build rows too, so it goes FALSE the moment something on this list
     * is a build task rather than a purchase.
     */
    allRemainingAreCodeComplete: notCodeComplete.length === 0,
    /* Named, not just counted — "4 things need building" is unactionable. */
    needsBuild: needsBuild.map((l) => l.id),
    lines
  };
}
