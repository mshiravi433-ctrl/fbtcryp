/**
 * SIGN THE THORCHAIN DEPOSIT ON THIS PAGE — EVM sources only.
 * ---------------------------------------------------------------------------
 * ─── WHAT WAS ASKED ─────────────────────────────────────────────────────────
 *   «با فکر عمیق ببین نمیشه در خود سایت ما انجام شود به جای گذاشتن memo و
 *    ادرس را در تورچین در خود سایت باشد و مشتری امضا کند فقط»
 *
 * Deep answer: YES for EVM sources, NO for the rest — and the split is not a
 * product choice, it is what a wallet signature IS:
 *
 *   ETH / BSC / AVAX / Base  → the deposit is a CONTRACT CALL on a chain the
 *                              connected wallet already signs for. The router's
 *                              depositWithExpiry(vault, asset, amount, memo,
 *                              expiry) is one transaction we can build here;
 *                              the user taps once and signs. This module does
 *                              exactly that.
 *   BTC / BCH / LTC / DOGE   → the deposit is a UTXO spend with an OP_RETURN
 *                              output. No EVM wallet can sign that shape, and
 *                              this app has no Bitcoin signer. The manual
 *                              address + memo path (ThorDepositGuide) stays.
 *   GAIA / THOR              → Cosmos SDK messages; same story as UTXO.
 *
 * ─── WHY THIS IS SAFE TO OFFER, NOT JUST POSSIBLE ───────────────────────────
 * The custody model does not change. We build the transaction; the USER's
 * wallet signs it; we never hold keys and never submit on anyone's behalf —
 * the same line the LI.FI/deBridge paths already draw. The memo is not
 * assembled in the browser: it comes from OUR server's quote, which is
 * THORChain's own memo with our affiliate attached server-side
 * (server/thorchain.js). An attacker who could edit the memo in the browser
 * could already edit it anywhere — the wallet shows the calldata, and
 * depositWithExpiry on-chain enforces the expiry THORChain quoted.
 *
 * The vault (inbound_address), router and expiry are taken from the SAME quote
 * the user is looking at, and re-validated here before anything is signed:
 * the money path never trusts that the UI checked.
 *
 * ─── THE AFFILIATE RIDES ALONG ──────────────────────────────────────────────
 * EVM memos have no length limit, so the server attaches our full affiliate
 * address on every EVM source (the 80-byte OP_RETURN wall only exists on the
 * Bitcoin family). Signing here instead of sending a user to THORSwap means
 * the fee is guaranteed to be OUR memo, not someone else's UI quietly
 * dropping it.
 */

import { chainOf } from './thorAddress.js';
import { assetLabel } from './thorswap.js';

/**
 * THORChain's EVM chains → the chainIds this app's wallet already knows
 * (src/lib/chains.js EVM_CHAINS). Every one of them must exist there or
 * wallet.switchChain() would refuse, so this map is checked against it by
 * the panel before the sign card is ever shown.
 */
export const THOR_EVM_CHAIN_IDS = { ETH: 1, BSC: 56, AVAX: 43114, BASE: 8453 };

/** depositWithExpiry — the ONLY entry point. Plain `deposit` ignores the
 *  expiry and would let a stale quote land in a live vault; THORChain's own
 *  docs send integrators here. */
const ROUTER_ABI = [
  'function depositWithExpiry(address vault, address asset, uint256 amount, string memo, uint256 expiration)'
];

/* Only what the money path needs. decimals() is read from the token itself
   rather than trusted from a registry: a decimals mismatch would send 10^12
   times too much or too little, and the contract is the authority. */
const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)'
];

const EVM_ADDRESS = /^0[xX][a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Valid EVM address → lowercase, the form every check downstream wants;
 *  anything else → null. THORChain may hand us `0X…` (uppercase prefix). */
const evmAddr = (v) => {
  const s = String(v ?? '');
  return EVM_ADDRESS.test(s) ? s.toLowerCase() : null;
};

/** The EVM chainId a THORChain asset can be signed on, or null. */
export function thorEvmChainId(asset) {
  const id = THOR_EVM_CHAIN_IDS[chainOf(asset)];
  return Number.isFinite(id) ? id : null;
}

/**
 * `ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48` → the contract
 * address (lowercased); `ETH.ETH` (or anything without a `-0x…` suffix) →
 * null = the chain's native coin, which travels as msg.value with asset 0x0.
 *
 * THORChain uppercases the whole suffix — including the `0X` prefix — so the
 * pattern accepts both prefixes and the answer is LOWERCASED: every consumer
 * (address regexes, ethers Contract construction, case-insensitive
 * comparisons) is defined on lowercase, and a checksumless all-uppercase
 * string would silently fail exactly one of them, at signing time.
 */
export function thorEvmToken(asset) {
  const right = String(asset ?? '').split('.')[1] ?? '';
  const suffix = right.split('-')[1];
  return EVM_ADDRESS.test(suffix ?? '') ? suffix.toLowerCase() : null;
}

/**
 * A decimal string → base units as BigInt. Not Number() anywhere: a float
 * loses precision above 2^53, which on an 18-decimal chain is 0.01 ETH.
 * More fractional digits than the asset has decimals is REJECTED, not
 * rounded — a rounded amount is a different amount than the one quoted.
 */
export function toEvmBaseUnits(amount, decimals) {
  const s = String(amount ?? '').trim();
  if (!/^\d{1,30}(\.\d{1,30})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 36) return null;
  if (frac.length > d) return null;
  const units = BigInt(whole + frac.padEnd(d, '0'));
  return units > 0n ? units : null;
}

/**
 * The memo's receiver must be the destination the user typed, re-checked at
 * execution time rather than trusted from the render. Mirrors
 * thorDepositState's logic (EVM targets compare case-insensitively) but on
 * the money path, because a memo paying a different address than the one on
 * screen is indistinguishable from theft.
 */
export function memoReceiverMatches(memo, destination, toAsset) {
  const parts = String(memo ?? '').split(':');
  if (!['=', 's', 'SWAP'].includes(parts[0])) return false;
  const receiver = parts[2];
  const dest = String(destination ?? '').trim();
  if (!receiver || !dest) return false;
  const evmTarget = ['ETH', 'BSC', 'AVAX', 'BASE'].includes(chainOf(toAsset));
  return evmTarget
    ? receiver.toLowerCase() === dest.toLowerCase()
    : receiver === dest;
}

/**
 * Normalise THORNode /thorchain/tx/status/{hash} into a shape the tracker can
 * render without knowing the node's schema history. Stage objects have been
 * `{ completed: bool, … }` on every version this integration has seen; a
 * `status: 'success'` shape is accepted too so a node upgrade degrades to a
 * still-honest "in progress" instead of a crash.
 */
export function normalizeThorTxStatus(status) {
  const stages = status?.stages ?? {};
  const done = (s) => s?.completed === true || s?.status === 'success';
  const keys = [
    ['inbound_observed', 'seen'],
    ['inbound_finalised', 'confirmed'],
    ['swap_finalised', 'swapped'],
    ['outbound_signed', 'delivered']
  ].map(([k, label]) => ({ key: k, label, completed: done(stages[k]) }));
  const delivered = done(stages.outbound_signed);
  /* The first uncompleted stage is the honest "where it is now" answer; when
     none has completed the source tx simply has not been observed yet —
     expected for the first seconds after broadcast. */
  const pending = keys.find((k) => !k.completed)?.label ?? null;
  return { delivered, stages: keys, pending, raw: status ?? null };
}

/**
 * Build, check and send ONE THORChain router deposit. The signature is the
 * user's; this function's job is to make sure what they sign is exactly the
 * quote on the screen.
 *
 * @param {object} wallet   the WalletContext value (address, chainId,
 *                          switchChain, getSigner)
 * @param {object} quote    a READY quote from our server: inbound_address,
 *                          router, memo, expiry — all from THORChain
 * @param {string} from     source asset, e.g. 'ETH.USDC-0XA0B8…'
 * @param {string} to       target asset, for the memo receiver re-check
 * @param {string} amount   human decimal string, e.g. '0.01'
 * @param {string} destination  the receiving address typed by the user
 * @param {function} [confirmSigning] async () => boolean — the signing
 *        review sheet (BridgeSigningReview), shown before the FIRST of up to
 *        three signatures (reset-approve, approve, deposit)
 * @param {function} [onStep] progress callback: 'network' | 'allowance' |
 *        'deposit' — the panel maps these to translated lines
 * @returns {Promise<{hash: string, chainId: number}>}
 */
export async function executeThorEvmDeposit({
  wallet, quote, from, to, amount, destination, confirmSigning, onStep
}) {
  const chainId = thorEvmChainId(from);
  if (!chainId) throw new Error('NOT_EVM_SOURCE');

  const router = evmAddr(quote?.router);
  const vault = evmAddr(quote?.inbound_address);
  const memo = String(quote?.memo ?? '');
  const expiry = Number(quote?.expiry);

  /* Structural checks before the wallet is ever touched. The router and the
     vault must be distinct real addresses: a "router" equal to the vault (or
     to the user) is a malformed or hostile quote, not a deposit. */
  if (!router || !vault || router === vault) throw new Error('BAD_DEPOSIT_TARGET');
  if (!memo || !Number.isFinite(expiry) || expiry <= 0) throw new Error('BAD_QUOTE');

  /* The memo must still pay the address on screen. */
  if (!memoReceiverMatches(memo, destination, to)) throw new Error('MEMO_MISMATCH');

  /*
   * A quote that expires mid-flow is worse than no quote: the approval
   * transaction succeeds (and costs gas), then depositWithExpiry reverts
   * because THORChain's vault has moved on. 120 seconds of margin covers a
   * slow approval + a slow wallet prompt; thorDepositState already gates the
   * UI at 30s, this is the stricter, money-path re-check.
   */
  if (expiry * 1000 <= Date.now() + 120_000) throw new Error('EXPIRING');

  const token = thorEvmToken(from);

  if (Number(wallet?.chainId) !== chainId) {
    onStep?.('network');
    const switched = await wallet.switchChain?.(chainId);
    if (!switched && Number(wallet.chainId) !== chainId) throw new Error('WRONG_NETWORK');
  }
  const signer = wallet.getSigner?.();
  if (!signer) throw new Error('NO_SIGNER');

  const { Contract } = await import('ethers');
  const { assertBridgeSigner, assertBridgeContracts, validateBridgeRequest } = await import('./bridgeSafety.js');

  /*
   * The router MUST be a contract on the chain we are about to sign on. A
   * fresh address with no code eats the user's gas and returns nothing; the
   * same assertBridgeContracts the LI.FI/deBridge paths use. The token is
   * checked with it — a token with no code is a phishing artefact.
   */
  await assertBridgeContracts(signer.provider, [router, ...(token ? [token] : [])]);

  let decimals = 18; /* every THORChain EVM native coin is 18 decimals */
  let tokenContract = null;
  if (token) {
    tokenContract = new Contract(token, ERC20_ABI, signer);
    decimals = Number(await tokenContract.decimals());
    if (!Number.isInteger(decimals) || decimals < 0) throw new Error('BAD_TOKEN');
  }

  const units = toEvmBaseUnits(amount, decimals);
  if (!units) throw new Error('BAD_AMOUNT');

  /* Build the calldata ourselves so what is validated is exactly what is
     sent — not an ethers proxy object with its own ideas. */
  const routerContract = new Contract(router, ROUTER_ABI, signer);
  const data = routerContract.interface.encodeFunctionData(
    'depositWithExpiry',
    [vault, token ?? ZERO_ADDRESS, units, memo, BigInt(expiry)]
  );

  const tx = {
    to: router,
    data,
    chainId,
    from: wallet.address,
    /* The native coin travels in `value` AND in the `amount` argument; the
       router requires them to match, so one BigInt feeds both. */
    value: token ? 0n : units
  };

  if (!validateBridgeRequest({
    token: token ?? vault, /* placeholder for the native path — `native: true`
       makes validateBridgeRequest skip the token/spender rules; it must
       still be a valid non-zero address for the other checks. */
    spender: router,
    transaction: tx,
    chainId,
    sender: wallet.address,
    recipient: vault,
    native: !token
  })) throw new Error('UNSAFE_DEPOSIT');

  if (tokenContract) {
    await assertBridgeSigner(signer, chainId, wallet.address);
    const current = await tokenContract.allowance(wallet.address, router);
    if (current < units) {
      /*
       * ONE review before the first of up to three signatures (reset,
       * approve, deposit) — the same treatment runDln gives the deBridge
       * path. The sheet names the token, the spender (the router) and the
       * vault so an address-poisoning paste is visible before any gas is
       * spent, not after.
       */
      const ok = await confirmSigning?.({
        token,
        spender: router,
        contract: router,
        recipient: vault,
        chainId,
        provider: 'THORChain',
        amount: units.toString(),
        decimals,
        symbol: assetLabel(from)
      });
      if (ok === false) throw new Error('USER_REJECTED');

      /* Some ERC-20s refuse a non-zero → non-zero change; zero it first.
         Exact-amount approval, never infinite — the rule lib/swap.js
         documents and every money path here repeats. */
      if (current > 0n) {
        await assertBridgeSigner(signer, chainId, wallet.address);
        const reset = await tokenContract.approve(router, 0n, { chainId });
        await reset.wait();
      }
      onStep?.('allowance');
      await assertBridgeSigner(signer, chainId, wallet.address);
      const approval = await tokenContract.approve(router, units, { chainId });
      await approval.wait();
    }
  }

  onStep?.('deposit');
  /* Re-check the signer AFTER any approval: a chain switch or account change
     during the wait would otherwise sign the deposit with a different wallet
     than the one that was reviewed. */
  await assertBridgeSigner(signer, chainId, wallet.address);
  const sent = await signer.sendTransaction(tx);
  return { hash: sent.hash, chainId };
}
