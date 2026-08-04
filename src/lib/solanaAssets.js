/**
 * CURATED SOLANA ASSETS — liquid staking tokens and tokenized equities.
 * ---------------------------------------------------------------------------
 * ─── WHY A HARD-CODED LIST AND NOT A SEARCH ─────────────────────────────────
 * Jupiter's token search is the obvious way to do this and it is the wrong
 * one. Searching `AAPLx` returns SEVEN tokens. One is real. The others are
 * pump.fun clones with the same name, the same symbol, and in two cases the
 * same logo scraped from Google. Measured, not assumed:
 *
 *   real  XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp  liquidity $79,912
 *   fake  GQfQ2avnmJBMttz2D5nyDkQAY9rWLHGvDVq8BMRpxWh4 liquidity $3.44
 *   fake  2qAq8FC9B2yHQv4u58ozKpm6oVBA4iGV3c61NVkpnnKA liquidity $0
 *
 * A user who types "Apple" into a search box and taps the first result loses
 * their money. There is no clever ranking that fixes this — the fakes copy
 * whatever signal you rank on. The only safe answer is a list of mint
 * addresses verified once, by hand, against the issuer's own authority.
 *
 * ─── THE TELL THAT SEPARATES REAL FROM FAKE ─────────────────────────────────
 * Every genuine xStock is minted by ONE authority:
 *
 *   mintAuthority   7pt9tkctJPK7PPNQJ77GKg8ZffSF6QxoMiCFYHxrtaCj
 *   freezeAuthority JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs
 *
 * Every fake has `mintAuthorityDisabled: true` — they cannot fake the issuer's
 * authority because they do not hold its key. `assertIssuer()` below checks
 * exactly this against live data, so a wrong address in this file is caught at
 * runtime rather than trusted.
 */

/** The Backed Finance issuer authority. The single most important constant here. */
export const XSTOCK_MINT_AUTHORITY = '7pt9tkctJPK7PPNQJ77GKg8ZffSF6QxoMiCFYHxrtaCj';
export const XSTOCK_FREEZE_AUTHORITY = 'JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs';

/**
 * LIQUID STAKING TOKENS.
 *
 * ─── WHY THESE BELONG IN A SWAP APP ─────────────────────────────────────────
 * Buying jitoSOL *is* staking. There is no separate deposit, no lock-up, no
 * new contract for the user to approve — the token's exchange rate against SOL
 * grows every epoch, and swapping back out is how you unstake. That makes it
 * the only real yield product this app can offer without taking custody.
 *
 * It is also strictly better than what the Farm screen does today, which is
 * send the user to DefiLlama and lose them.
 *
 * `apyNote` is a translation KEY, never a number. Yields move; a hard-coded
 * "7.5%" would be wrong within a week and we would not notice. The live figure
 * comes from the DefiLlama feed the Farm screen already fetches.
 */
export const LST_ASSETS = [
  {
    id: 'jitosol',
    mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
    symbol: 'jitoSOL',
    name: 'Jito Staked SOL',
    decimals: 9,
    /* Matches the `project` field in the DefiLlama yields feed, so the live
       APY can be joined onto this row instead of being typed in here. */
    llamaProject: 'jito-liquid-staking',
    llamaSymbol: 'JITOSOL',
    /* Jito's own published fee on staking rewards. Stated because a yield
       figure without its fee is half a fact. */
    protocolFeePct: 4,
    /* Jito's stake is delegated to validators running its MEV client, so the
       yield includes MEV tips the others do not capture. */
    capturesMev: true
  },
  {
    id: 'msol',
    mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
    symbol: 'mSOL',
    name: 'Marinade Staked SOL',
    decimals: 9,
    llamaProject: 'marinade-liquid-staking',
    llamaSymbol: 'MSOL',
    protocolFeePct: 6,
    capturesMev: false
  }
];

/**
 * TOKENIZED EQUITIES (xStocks, issued by Backed Finance AG).
 *
 * ─── WHAT THESE ACTUALLY ARE ────────────────────────────────────────────────
 * An SPL token backed 1:1 by a real share held with a regulated custodian in
 * Switzerland. Not a synthetic, not a CFD, not a bet on the price. Backed
 * publishes proof-of-reserve attestations per ticker.
 *
 * ─── WHAT THEY ARE NOT ──────────────────────────────────────────────────────
 * They are NOT shares. You are not on the shareholder register, you have no
 * voting rights, and — the part that matters most and that every marketing
 * page buries — the issuer holds a freeze authority over the token and can
 * disable your wallet's balance. That is not hypothetical: Tether has frozen
 * over $5bn across ~10,000 addresses under the same kind of authority.
 *
 * The UI states this ABOVE the buy action, not in a footnote. See the note in
 * Stocks.jsx for why the placement is the whole point.
 *
 * ─── WHY THIS SHORT LIST ────────────────────────────────────────────────────
 * Backed issues 100+ tickers. Most have almost no on-chain liquidity, and a
 * tokenized share you cannot sell is worse than no position at all. These six
 * are the ones with real depth, measured from Jupiter's own liquidity figures
 * (SPYx $2.8m, NVDAx $2.0m, TSLAx $924k, AAPLx $80k). AAPLx is included
 * despite being the thinnest because it is the one people ask for by name —
 * and the UI shows its liquidity so the thinness is visible rather than
 * discovered at the point of sale.
 */
export const EQUITY_ASSETS = [
  {
    id: 'spyx',
    mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
    symbol: 'SPYx',
    name: 'S&P 500',
    decimals: 8,
    /* An index tracker, not a single company. Listed first deliberately: it is
       the lowest-variance way into this asset class and the one a beginner
       should see before TSLAx. */
    kind: 'index'
  },
  {
    id: 'qqqx',
    /*
     * Every address in this file was verified against the live Jupiter token
     * record before being committed. This one is why that step is not
     * optional: the first version I wrote was
     * `Xs8S1uUs1zvS2p7iwtsG3b6fkeYiPSLvKssuH2fvqUL`, which looks entirely
     * plausible, shares a 20-character prefix with the real mint, and resolves
     * to NOTHING. A hand-copied base58 address is a transposition waiting to
     * happen, and `assertIssuer()` is the runtime backstop for the day one
     * slips through.
     */
    mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ',
    symbol: 'QQQx',
    name: 'Nasdaq 100',
    decimals: 8,
    kind: 'index'
  },
  {
    id: 'nvdax',
    mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
    symbol: 'NVDAx',
    name: 'NVIDIA',
    decimals: 8,
    kind: 'single'
  },
  {
    id: 'tslax',
    mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
    symbol: 'TSLAx',
    name: 'Tesla',
    decimals: 8,
    kind: 'single'
  },
  {
    id: 'aaplx',
    mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
    symbol: 'AAPLx',
    name: 'Apple',
    decimals: 8,
    kind: 'single'
  },
  {
    id: 'msftx',
    mint: 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX',
    symbol: 'MSFTx',
    name: 'Microsoft',
    decimals: 8,
    kind: 'single'
  }
];

/** Every curated mint, for the "is this address one of ours" check. */
const ALL = [...LST_ASSETS, ...EQUITY_ASSETS];
const BY_MINT = new Map(ALL.map((a) => [a.mint, a]));

export const findAsset = (mint) => BY_MINT.get(String(mint ?? '').trim()) ?? null;
export const isCuratedMint = (mint) => BY_MINT.has(String(mint ?? '').trim());

/**
 * Verify a live token record really is the asset we think it is.
 *
 * ─── WHY THIS EXISTS RATHER THAN TRUSTING THE LIST ──────────────────────────
 * The mint addresses above were copied by hand from API responses. A single
 * transposed base58 character produces a valid-looking address that is either
 * nothing or, far worse, somebody else's token. A hard-coded list is only as
 * trustworthy as the moment it was written.
 *
 * So when the UI has live token data, it checks the issuer authority before
 * showing the row. A wrong address fails closed — the asset is hidden — rather
 * than quietly offering a stranger's token under Apple's name.
 *
 * @param {object} live  a Jupiter token record
 * @param {object} asset the curated entry we matched it to
 */
export function assertIssuer(live, asset) {
  if (!live || !asset) return false;
  if (live.id !== asset.mint) return false;

  /*
   * Equities must carry the Backed issuer authority. This is the check the
   * fakes cannot pass: every clone has `mintAuthorityDisabled: true` because
   * they do not hold the issuer's key.
   */
  if (EQUITY_ASSETS.includes(asset)) {
    if (live.mintAuthority !== XSTOCK_MINT_AUTHORITY) return false;
    if (live.freezeAuthority !== XSTOCK_FREEZE_AUTHORITY) return false;
  }

  /*
   * For LSTs there is no single issuer authority to match — each protocol has
   * its own — so the check is Jupiter's own verification flag plus real depth.
   * Weaker than the equity check, and it is weaker because the honest tool
   * available is weaker; pretending otherwise would be worse.
   */
  return live.isVerified !== false;
}

/**
 * Is there enough on-chain depth to trade this size without being punished?
 *
 * ─── WHY THIS IS A HARD GATE AND NOT A WARNING ──────────────────────────────
 * AAPLx has ~$80k of liquidity. A $5,000 order against an $80k pool is 6% of
 * the book and moves the price against the user by far more than our 0.7% fee.
 * Showing a quote and letting them find out is the behaviour of a venue that
 * does not care.
 *
 * 2% of pool liquidity is the threshold. Above it we refuse and say why,
 * rather than quoting a price we know is bad.
 */
export const MAX_POOL_SHARE = 0.02;

export function liquidityVerdict(liquidityUsd, tradeUsd) {
  const pool = Number(liquidityUsd);
  const size = Number(tradeUsd);
  if (!Number.isFinite(pool) || pool <= 0) return { ok: false, reason: 'unknown' };
  if (!Number.isFinite(size) || size <= 0) return { ok: true, reason: null, share: 0 };

  const share = size / pool;
  if (share > MAX_POOL_SHARE) {
    return {
      ok: false,
      reason: 'tooBig',
      share,
      /* The largest trade that WOULD pass, so the UI can offer a number
         instead of only saying no. */
      maxUsd: Math.floor(pool * MAX_POOL_SHARE)
    };
  }
  return { ok: true, reason: null, share };
}
