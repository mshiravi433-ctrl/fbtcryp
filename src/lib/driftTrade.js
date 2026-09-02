/**
 * DRIFT (Solana) TRADE EXECUTION — client-side, wallet-signed.
 * ---------------------------------------------------------------------------
 * The On-Chain futures tab actually opens/closes positions on Drift. FBT never
 * holds a key: this module builds Drift instructions with the official
 * @drift-labs/sdk and asks the connected Solana wallet (Phantom / Solflare /
 * Backpack / Mobile Wallet Adapter) to SIGN AND SEND every transaction. The
 * server only supplies quote/risk/fee truth and verifies the receipt.
 *
 * Opening a position, end to end (each step its own signed tx):
 *   1. the Solana wallet is connected (lib/solanaWallet.js)
 *   2. the Drift user account is created on first use (referrer = FBT)
 *   3. USDC collateral is deposited (getDepositInstruction)
 *   4. the perp market order is placed (getPlacePerpOrderIx), with the FBT
 *      referrer recorded on the user account so the venue attributes fills
 *   5. every signature is returned for backend /verify + ledger
 *
 * The SDK stack ships as a single esbuild-prebundled ESM file
 * (public/vendor/drift-sdk.js — see scripts/vendor-drift.mjs) loaded here at
 * runtime via dynamic import. Users who never open the Drift tab never
 * download it, and the Rollup production build never parses the SDK's ~2700
 * CJS modules (that exhausted the 4GB build sandbox).
 */
import { getSolanaProvider, getMwaWallet, mwaAccountInfo } from './solanaWallet.js';
export { DRIFT_PERP_INDEX, driftPerpIndex } from './driftMarkets.js';

const DRIFT_VENDOR_URL = `${import.meta.env?.BASE_URL || '/'}vendor/drift-sdk.js`;

let sdkPromise = null;
async function loadDriftSdk() {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      const sdk = await import(/* @vite-ignore */ `${DRIFT_VENDOR_URL}?v=2155`);
      return sdk;
    })();
  }
  return sdkPromise;
}

const SOL_RPC = (
  (typeof import.meta !== 'undefined' && import.meta.env && (import.meta.env.VITE_SOLANA_RPC || import.meta.env.VITE_SOLANA_RPC_URL))
  || (typeof process !== 'undefined' && process.env && (process.env.VITE_SOLANA_RPC || process.env.SOLANA_RPC_URL))
  || 'https://api.mainnet-beta.solana.com'
);

/** FBT Drift referrer AUTHORITY (a Solana pubkey). Empty = no on-chain rebate. */
const FBT_REFERRER = String(
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_DRIFT_REFERRER)
  || (typeof process !== 'undefined' && process.env && (process.env.DRIFT_REFERRER || process.env.VITE_DRIFT_REFERRER))
  || ''
);

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/* ── signing wallet (injected extension or Mobile Wallet Adapter) ────────── */

async function getSigningProvider() {
  const injected = getSolanaProvider();
  if (injected?.publicKey) return { kind: 'injected', provider: injected, address: injected.publicKey.toString() };
  const mwa = typeof getMwaWallet === 'function' ? getMwaWallet() : null;
  const acc = typeof mwaAccountInfo === 'function' ? mwaAccountInfo() : null;
  if (mwa) return { kind: 'mwa', provider: mwa, address: acc?.address };
  return null;
}

const walletSigner = (authority, signing) => ({
  publicKey: authority,
  signTransaction: (tx) => signWith(signing, tx).then((r) => r.tx),
  signAllTransactions: async (txs) => Promise.all(txs.map((tx) => signWith(signing, tx).then((r) => r.tx)))
});

async function signWith(signing, tx) {
  if (signing.kind === 'mwa') {
    const feature = signing.provider.features?.['solana:signAndSendTransaction'];
    if (!feature) throw Object.assign(new Error('CANNOT_SIGN'), { code: 'CANNOT_SIGN' });
    const results = await feature.signAndSendTransaction({
      account: mwaAccountInfo(), transaction: tx.serialize(), chain: 'solana:mainnet',
      options: { commitment: 'confirmed', skipPreflight: false, maxRetries: 3 }
    });
    const signature = results?.[0]?.signature;
    if (!(signature instanceof Uint8Array)) throw Object.assign(new Error('NO_SIGNATURE'), { code: 'NO_SIGNATURE' });
    return { tx, signature: base58(signature) };
  }
  const provider = signing.provider;
  if (typeof provider.signTransaction === 'function') {
    const signed = await provider.signTransaction(tx);
    return { tx: signed, signature: txSignature(signed) };
  }
  throw Object.assign(new Error('CANNOT_SIGN'), { code: 'CANNOT_SIGN' });
}

function txSignature(tx) {
  const sig = tx.signatures?.[0];
  return sig ? base58(sig) : null;
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let str = '';
  while (n > 0n) { str = BASE58_ALPHABET[Number(n % 58n)] + str; n /= 58n; }
  for (const b of bytes) { if (b === 0) str = BASE58_ALPHABET[0] + str; else break; }
  return str;
}

/** A subscribed DriftClient whose "wallet" routes to the real connected one. */
async function createDriftClient(sdk, walletAddress) {
  const { Connection, PublicKey, DriftClient, DRIFT_PROGRAM_ID, getUserAccountPublicKey } = sdk;
  const connection = new Connection(SOL_RPC, 'confirmed');
  const authority = new PublicKey(walletAddress);
  const signing = await getSigningProvider();
  if (!signing) throw Object.assign(new Error('WALLET_NOT_CONNECTED'), { code: 'WALLET_NOT_CONNECTED' });
  const client = new DriftClient({ connection, wallet: walletSigner(authority, signing), env: 'mainnet-beta', activeSubAccountId: 0 });
  await client.subscribe();
  const userAccount = await getUserAccountPublicKey(new PublicKey(DRIFT_PROGRAM_ID), authority, 0);
  const accountInfo = await connection.getAccountInfo(userAccount);
  return { client, connection, signing, authority, userAccount, userExists: Boolean(accountInfo) };
}

/** Sign + send a VersionedTransaction built from Drift instructions. */
async function sendInstructions(sdk, ctx, instructions) {
  const { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } = sdk;
  const bh = await ctx.connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: ctx.authority, recentBlockhash: bh.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200 }),
      ...instructions
    ]
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const { tx: signed, signature } = await signWith(ctx.signing, tx);
  try {
    await ctx.connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
    await ctx.connection.confirmTransaction({ signature, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, 'confirmed');
  } catch {
    /* MWA already broadcasts; confirm the signature directly. */
    await ctx.connection.confirmTransaction(signature, 'confirmed').catch(() => {});
  }
  return signature;
}

/** Build FBT's ReferrerInfo ({referrer, referrerStats}) when configured + valid. */
function fbtReferrerInfo(sdk) {
  try {
    if (!FBT_REFERRER) return undefined;
    const { PublicKey, DRIFT_PROGRAM_ID, getUserStatsAccountPublicKey } = sdk;
    const referrer = new PublicKey(FBT_REFERRER);
    return { referrer, referrerStats: getUserStatsAccountPublicKey(new PublicKey(DRIFT_PROGRAM_ID), referrer) };
  } catch { return undefined; }
}

/* ── public operations ─────────────────────────────────────────────────── */

/**
 * Open a Drift perp position with the user's own wallet.
 */
export async function openDriftPosition({ wallet, marketIndex, side, notionalUsd, oraclePrice, slippageBps = 25, depositUsdc = 0 }) {
  const sdk = await loadDriftSdk();
  const { BN, OrderType, MarketType, PositionDirection, PostOnlyParams, PublicKey } = sdk;
  const ctx = await createDriftClient(sdk, wallet);
  const txs = [];
  try {
    const referrer = fbtReferrerInfo(sdk);

    /* 1) first-time Drift user account (records FBT as the referrer) */
    if (!ctx.userExists) {
      const [ixs] = await ctx.client.getInitializeUserAccountIxs(0, 'FBT', referrer);
      txs.push({ kind: 'init', signature: await sendInstructions(sdk, ctx, ixs) });
      await ctx.client.fetchAccounts().catch(() => {});
    }

    /* 2) deposit USDC collateral — only the top-up actually needed. Existing
       Drift USDC (spot balance + unrealised quote) already counts as margin,
       so depositing the full requested collateral on every trade would lock
       twice the margin; compare against what the account already holds. */
    if (depositUsdc > 0) {
      let existing = 0;
      try {
        if (ctx.userExists && typeof ctx.client.getQuoteAssetTokenAmount === 'function') {
          existing = ctx.client.getQuoteAssetTokenAmount().toNumber() / 1_000_000;
        }
      } catch { /* first account: existing stays 0 */ }
      const need = Math.max(0, Number(depositUsdc) - existing);
      if (need >= 1) {
        const ata = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), ctx.authority);
        const ix = await ctx.client.getDepositInstruction(new BN(Math.round(need * 1_000_000)), 0, ata, 0, false, ctx.userExists);
        txs.push({ kind: 'deposit', signature: await sendInstructions(sdk, ctx, [ix]) });
      }
    }

    /* 3) the perp market order — base amount in 1e9 base precision */
    const baseUnits = Math.max(1, Math.floor((Number(notionalUsd) / Number(oraclePrice)) * 1e9));
    const baseAssetAmount = new BN(baseUnits);
    const driftPrice = new BN(Math.round(Number(oraclePrice) * 1e6));
    const slip = Math.max(0, Number(slippageBps) || 25);
    const worstPrice = side === 'long'
      ? driftPrice.mul(new BN(10_000 + slip)).div(new BN(10_000))
      : driftPrice.mul(new BN(10_000 - slip)).div(new BN(10_000));

    const ix = await ctx.client.getPlacePerpOrderIx(
      { orderType: OrderType.MARKET, marketType: MarketType.PERP, marketIndex: Number(marketIndex),
        direction: side === 'short' ? PositionDirection.SHORT : PositionDirection.LONG,
        baseAssetAmount, price: worstPrice, reduceOnly: false, postOnly: PostOnlyParams.NONE,
        auctionStartPrice: null, auctionEndPrice: null, auctionDuration: null, userOrderId: 0 },
      0
    );
    const signature = await sendInstructions(sdk, ctx, [ix]);
    txs.push({ kind: 'open', signature });
    return { signature, transactions: txs, marketIndex: Number(marketIndex), side, baseUnits };
  } finally {
    try { await ctx.client.unsubscribe(); } catch { /* best effort */ }
  }
}

/** Close an open perp position (reduce-only market order in the opposite direction). */
export async function closeDriftPosition({ wallet, marketIndex }) {
  const sdk = await loadDriftSdk();
  const { BN, OrderType, MarketType, PositionDirection, PostOnlyParams } = sdk;
  const ctx = await createDriftClient(sdk, wallet);
  try {
    const user = ctx.client.getUser(0);
    const pos = user?.getPerpPosition ? user.getPerpPosition(Number(marketIndex)) : null;
    const amount = pos?.baseAssetAmount;
    if (!amount || amount.isZero()) throw Object.assign(new Error('NO_POSITION'), { code: 'NO_POSITION' });
    const isLong = !amount.isNeg();
    /* cancel any resting TP/SL triggers so a closed position can't be
       resurrected by a stale reduce-only order */
    const cancelIx = await ctx.client.getCancelOrdersIx(MarketType.PERP, Number(marketIndex), null, 0);
    if (cancelIx) await sendInstructions(sdk, ctx, [cancelIx]).catch(() => {});
    const ix = await ctx.client.getPlacePerpOrderIx(
      { orderType: OrderType.MARKET, marketType: MarketType.PERP, marketIndex: Number(marketIndex),
        direction: isLong ? PositionDirection.SHORT : PositionDirection.LONG,
        baseAssetAmount: amount.abs(), price: new BN(0), reduceOnly: true, postOnly: PostOnlyParams.NONE,
        auctionStartPrice: null, auctionEndPrice: null, auctionDuration: null, userOrderId: 0 },
      0
    );
    const signature = await sendInstructions(sdk, ctx, [ix]);
    return { signature, marketIndex: Number(marketIndex) };
  } finally {
    try { await ctx.client.unsubscribe(); } catch { /* best effort */ }
  }
}

/**
 * Attach (or replace) take-profit / stop-loss on an open perp position.
 *
 * Both are Drift reduce-only TRIGGER_MARKET orders:
 *   · take-profit — when the oracle crosses tpPrice in the profit direction
 *   · stop-loss   — when the oracle crosses slPrice in the loss direction
 * Longs exit with sells triggered ABOVE (TP) / BELOW (SL); shorts the mirror.
 * Any existing trigger orders for the market are cancelled first so the set
 * is always exactly what the user asked for (passing neither price removes).
 */
export async function setDriftTpSl({ wallet, marketIndex, tpPrice = null, slPrice = null }) {
  const sdk = await loadDriftSdk();
  const {
    BN, OrderType, MarketType, PositionDirection, PostOnlyParams, OrderTriggerCondition
  } = sdk;
  const ctx = await createDriftClient(sdk, wallet);
  const txs = [];
  try {
    const user = ctx.client.getUser(0);
    const pos = user?.getPerpPosition ? user.getPerpPosition(Number(marketIndex)) : null;
    const amount = pos?.baseAssetAmount;
    if (!amount || amount.isZero()) throw Object.assign(new Error('NO_POSITION'), { code: 'NO_POSITION' });
    const isLong = !amount.isNeg();
    const size = amount.abs();

    /* cancel every existing open order on this perp market (old TP/SL set) */
    const cancelIx = await ctx.client.getCancelOrdersIx(MarketType.PERP, Number(marketIndex), null, 0);
    if (cancelIx) txs.push({ kind: 'cancel', signature: await sendInstructions(sdk, ctx, [cancelIx]) });

    const triggers = [];
    if (tpPrice && Number(tpPrice) > 0) {
      triggers.push({
        price: Number(tpPrice),
        /* long TP triggers when price rises ABOVE; short TP when it falls BELOW */
        condition: isLong ? OrderTriggerCondition.ABOVE : OrderTriggerCondition.BELOW,
        kind: 'tp'
      });
    }
    if (slPrice && sPriceSafe(slPrice) > 0) {
      triggers.push({
        price: Number(slPrice),
        /* long SL triggers when price falls BELOW; short SL when it rises ABOVE */
        condition: isLong ? OrderTriggerCondition.BELOW : OrderTriggerCondition.ABOVE,
        kind: 'sl'
      });
    }
    for (const t of triggers) {
      const ix = await ctx.client.getPlacePerpOrderIx(
        { orderType: OrderType.TRIGGER_MARKET, marketType: MarketType.PERP, marketIndex: Number(marketIndex),
          direction: isLong ? PositionDirection.SHORT : PositionDirection.LONG,
          baseAssetAmount: size, triggerPrice: new BN(Math.round(t.price * 1e6)),
          triggerCondition: t.condition,
          price: new BN(0), reduceOnly: true, postOnly: PostOnlyParams.NONE,
          auctionStartPrice: null, auctionEndPrice: null, auctionDuration: null, userOrderId: 0 },
        0
      );
      txs.push({ kind: t.kind, signature: await sendInstructions(sdk, ctx, [ix]) });
    }
    return { marketIndex: Number(marketIndex), transactions: txs, tpSet: Boolean(tpPrice), slSet: Boolean(slPrice) };
  } finally {
    try { await ctx.client.unsubscribe(); } catch { /* best effort */ }
  }
}

/* guard: NaN/garbage stop prices never reach the order builder */
function sPriceSafe(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }

/** Cancel ALL open orders for a perp market (used when closing / moving TP/SL). */
export async function cancelDriftOrders({ wallet, marketIndex }) {
  const sdk = await loadDriftSdk();
  const { MarketType } = sdk;
  const ctx = await createDriftClient(sdk, wallet);
  try {
    const ix = await ctx.client.getCancelOrdersIx(MarketType.PERP, Number(marketIndex), null, 0);
    if (!ix) return { marketIndex: Number(marketIndex), signature: null, nothingToCancel: true };
    const signature = await sendInstructions(sdk, ctx, [ix]);
    return { marketIndex: Number(marketIndex), signature };
  } finally {
    try { await ctx.client.unsubscribe(); } catch { /* best effort */ }
  }
}

/** Live perp positions for this wallet (decoded via the SDK; never cached by us). */
export async function getDriftPositions({ wallet }) {
  const sdk = await loadDriftSdk();
  const ctx = await createDriftClient(sdk, wallet);
  try {
    if (!ctx.userExists) return { userExists: false, positions: [], collateralUsdc: 0, equityUsdc: 0 };
    const user = ctx.client.getUser(0);
    const rows = user?.getActivePerpPositions ? user.getActivePerpPositions() : [];
    const toNum = (bn) => (bn && typeof bn.toNumber === 'function' ? bn.toNumber() : 0) / 1_000_000;

    /* Open trigger orders (TP/SL) by market, so the management sheet can show
       and preserve the other trigger when replacing one. */
    const triggersByMarket = new Map();
    try {
      const orders = user?.getOpenOrders ? user.getOpenOrders() : [];
      const { OrderType: OT, OrderTriggerCondition: OTC, PositionDirection: PD } = sdk;
      const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      for (const o of orders) {
        if (!o || !eq(o.marketType, sdk.MarketType.PERP)) continue;
        const isTrigger = eq(o.orderType, OT.TRIGGER_MARKET) || eq(o.orderType, OT.TRIGGER_LIMIT);
        if (!isTrigger || !o.reduceOnly) continue;
        const k = Number(o.marketIndex);
        const cur = triggersByMarket.get(k) || { tp: null, sl: null };
        const price = o.triggerPrice ? o.triggerPrice.toNumber() / 1_000_000 : null;
        if (price == null) continue;
        /* A reduce-only trigger order that SELLS (exits a long): ABOVE = TP,
           BELOW = SL. A BUY reduce-only (exits a short) is the mirror. */
        const sells = eq(o.direction, PD.SHORT);
        const above = eq(o.triggerCondition, OTC.ABOVE);
        const isTp = sells ? above : !above;
        if (isTp) cur.tp = price; else cur.sl = price;
        triggersByMarket.set(k, cur);
      }
    } catch { /* triggers are best-effort metadata */ }

    return {
      userExists: true,
      positions: rows.map((p) => {
        const tr = triggersByMarket.get(Number(p.marketIndex)) || {};
        return {
          marketIndex: Number(p.marketIndex),
          baseAssetAmount: p.baseAssetAmount ? p.baseAssetAmount.toString() : '0',
          quoteAssetAmount: p.quoteAssetAmount ? p.quoteAssetAmount.toString() : '0',
          openOrders: Number(p.openOrders ?? 0),
          takeProfit: tr.tp ?? null,
          stopLoss: tr.sl ?? null
        };
      }),
      /* USDC spot deposits in the Drift account (free collateral) */
      collateralUsdc: ctx.client.getQuoteAssetTokenAmount ? toNum(ctx.client.getQuoteAssetTokenAmount()) : 0,
      equityUsdc: user?.getNetUsdValue ? toNum(user.getNetUsdValue()) : 0
    };
  } finally {
    try { await ctx.client.unsubscribe(); } catch { /* best effort */ }
  }
}
