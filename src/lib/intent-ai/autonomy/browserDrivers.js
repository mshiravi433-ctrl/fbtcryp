/**
 * FBT INTENT AI — BROWSER VENUE DRIVERS (autonomy core, layer 4b)
 * ---------------------------------------------------------------------------
 * This is the file that makes the difference between a shell and an executor.
 *
 * `venueExecutors.js` defines what each venue needs; this module hands it the
 * app's OWN trading primitives, lazily imported so nothing runs at module load:
 *
 *   swap     → lib/swap.js             getQuote / needsApproval / approveToken / executeSwap
 *   lending  → lib/lending.js          buildLendingPlan / runLendingPlan / readReserve / …
 *   aaveBase → lib/defi/aaveV3Base.js  getReserveStatus / buildSupplyPlan (the fork-probed pool)
 *   perp     → lib/velocityTrade.js    openVelocityPosition / closeVelocityPosition / setVelocityTpSl
 *   equity   → lib/solana.js + lib/solanaWallet.js  the exact path pages/Stocks.jsx buys through
 *
 * Nothing is re-implemented and nothing is proxied through the server: the
 * signatures happen next to the wallet, exactly as they do on the pages.
 *
 * Two rules shaped this file:
 *   1. Every import is inside a function, so `executionRuntime.js` stays
 *      importable from a Node probe without ethers or the Solana SDK.
 *   2. `probe()` and the token/market lookups are called SYNCHRONOUSLY by the
 *      executors, so the modules are read from a cache filled by `warm()`.
 *      Before warm() they return null, and the executor reports its own named
 *      failure — it never guesses an address or an index.
 */

let swapMod = null;
let chainsMod = null;
let lendingMod = null;
let aaveBaseMod = null;
let perpMod = null;
let perpMarketsMod = null;
let perpRiskMod = null;
let solanaMod = null;
let solanaWalletMod = null;
let solanaAssetsMod = null;

const loadSwap = async () => (swapMod ||= await import('../../swap.js'));
const loadChains = async () => (chainsMod ||= await import('../../chains.js'));
const loadLending = async () => (lendingMod ||= await import('../../lending.js'));
const loadAaveBase = async () => (aaveBaseMod ||= await import('../../defi/aaveV3Base.js'));
const loadPerp = async () => (perpMod ||= await import('../../velocityTrade.js'));
const loadPerpMarkets = async () => (perpMarketsMod ||= await import('../../velocityMarkets.js'));
const loadSolana = async () => (solanaMod ||= await import('../../solana.js'));
const loadSolanaWallet = async () => (solanaWalletMod ||= await import('../../solanaWallet.js'));
const loadSolanaAssets = async () => (solanaAssetsMod ||= await import('../../solanaAssetsClient.js'));
async function loadPerpRisk() {
  if (!perpRiskMod) {
    try { perpRiskMod = await import('../../futures-engine/risk.js'); } catch { perpRiskMod = {}; }
  }
  return perpRiskMod;
}

/**
 * Warm every module the drivers can need. Safe to call repeatedly — the
 * bundler caches the imports and the guards above cache the namespace objects.
 * The chat calls this when the wallet changes, before the first execution.
 */
export async function warmAutonomyDrivers() {
  await Promise.allSettled([
    loadSwap(), loadChains(), loadLending(), loadAaveBase(), loadPerp(),
    loadPerpMarkets(), loadSolana(), loadSolanaWallet(), loadSolanaAssets(), loadPerpRisk()
  ]);
  return { ok: true };
}

/** Which venues can actually run right now, for the confirmation card. */
export function autonomyDriverReadiness() {
  return {
    swap: Boolean(swapMod && chainsMod),
    lending: Boolean(lendingMod),
    aaveBase: Boolean(aaveBaseMod),
    perp: Boolean(perpMod && perpMarketsMod),
    equity: Boolean(solanaMod && solanaWalletMod),
    warmed: Boolean(swapMod && lendingMod && solanaMod)
  };
}

/**
 * Build the driver set for one connected wallet.
 *
 * @param {object} ctx
 * @param {object} ctx.wallet   WalletContext value (getSigner, getReadProvider, address, chainId)
 * @param {object} [ctx.solana] { connected, address } from useSolanaWallet
 * @param {function} [ctx.onStep]  progress callback for multi-signature lending plans
 * @param {function} [ctx.priceOf] live mark price reader, used by the perp planner
 * @param {object} [ctx.equityAssets] the asset rows the Stocks screen already fetched
 */
export function buildAutonomyDrivers({
  wallet = null,
  solana = null,
  onStep = null,
  priceOf = null,
  equityAssets = null
} = {}) {
  const walletApi = {
    getSigner: () => (typeof wallet?.getSigner === 'function' ? wallet.getSigner() : null),
    getReadProvider: async (chainId) => (typeof wallet?.getReadProvider === 'function'
      ? wallet.getReadProvider(chainId || wallet.chainId)
      : null)
  };

  const drivers = {
    wallet: walletApi,

    /* ── EVM swap ─────────────────────────────────────────────────────── */
    swap: {
      async getQuote({ chainId, fromSymbol, toSymbol, amount, slippage }) {
        const mod = await loadSwap();
        const chains = await loadChains();
        const fromToken = chains.getToken?.(chainId, fromSymbol);
        const toToken = chains.getToken?.(chainId, toSymbol);
        if (!fromToken || !toToken) return { error: 'TOKEN_NOT_LISTED' };
        const provider = await walletApi.getReadProvider(chainId);
        if (!provider) return { error: 'NO_PROVIDER' };
        return mod.getQuote({ provider, chainId, fromToken, toToken, amountIn: amount, slippage: slippage ?? 0.5 });
      },
      needsApproval: async (args) => (await loadSwap()).needsApproval(args),
      approveToken: async (args) => (await loadSwap()).approveToken(args),
      executeSwap: async (args) => (await loadSwap()).executeSwap(args),
      getTokenBalance: async (args) => (await loadSwap()).getTokenBalance(args),
      /* Synchronous by contract — the swap executor calls it inside probe(). */
      getToken: (chainId, symbol) => chainsMod?.getToken?.(chainId, symbol) || null
    },

    /* ── Aave v3 lending ──────────────────────────────────────────────── */
    lending: {
      lendingVenue: (chainId) => lendingMod?.lendingVenue?.(chainId) || null,
      lendingAssetsFor: (chainId) => lendingMod?.lendingAssetsFor?.(chainId) || [],
      toUnits: (amount, decimals) => lendingMod?.toUnits?.(amount, decimals) ?? null,
      buildLendingPlan: (args) => lendingMod?.buildLendingPlan?.(args) || null,
      readReserve: async (args) => (await loadLending()).readReserve(args),
      readAllowance: async (args) => (await loadLending()).readAllowance(args),
      runLendingPlan: async (args) => (await loadLending()).runLendingPlan({ ...args, onStep: onStep || args.onStep })
    },

    /* ── the fork-probed Base USDC pool ───────────────────────────────── */
    aaveBase: {
      get AAVE_V3_BASE() { return aaveBaseMod?.AAVE_V3_BASE || null; },
      getReserveStatus: async (provider) => (await loadAaveBase()).getReserveStatus(provider),
      buildSupplyPlan: async (args) => (await loadAaveBase()).buildSupplyPlan(args)
    },

    /* ── Solana perpetuals (Velocity) ─────────────────────────────────── */
    perp: {
      velocityPerpIndex: (symbol) => perpMarketsMod?.velocityPerpIndex?.(symbol) || null,
      openVelocityPosition: async (args) => (await loadPerp()).openVelocityPosition(args),
      closeVelocityPosition: async (args) => (await loadPerp()).closeVelocityPosition(args),
      setVelocityTpSl: async (args) => (await loadPerp()).setVelocityTpSl(args),
      getVelocityPositions: async (args) => (await loadPerp()).getVelocityPositions(args),
      confirmSignature: async (signature) => (await loadSolanaWallet()).confirmSolanaSignature(signature)
    },

    /* ── tokenised equities: pages/Stocks.jsx's own buy path ──────────── */
    equity: {
      get USDC_MINT() { return solanaMod?.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; },
      /**
       * The asset rows the Stocks screen already fetched are the registry — the
       * mint travels, never the symbol, because the symbol is the thing the
       * fakes clone. No row means the equity is not buyable here, and the probe
       * says so instead of inventing a mint.
       */
      resolveAsset: (symbolOrTicker) => {
        const rows = Array.isArray(equityAssets) ? equityAssets : (Array.isArray(solanaAssetsMod?.EQUITY_ASSETS) ? solanaAssetsMod.EQUITY_ASSETS : []);
        const key = String(symbolOrTicker || '').toUpperCase();
        if (!key) return null;
        return rows.find((a) => String(a?.symbol || '').toUpperCase() === key
          || String(a?.ticker || '').toUpperCase() === key
          || String(a?.name || '').toUpperCase() === key) || null;
      },
      getOrder: async ({ inputMint, outputMint, amountUsd, walletAddress }) => (await loadSolana())
        .getSolanaOrder({ inputMint, outputMint, amountUsd, walletAddress }),
      /**
       * Mirrors SolanaSwap.jsx exactly: Jupiter routes are signed here and
       * landed by the venue's own /execute (an RFQ route needs the market
       * maker's signature AFTER ours), everything else is signed and sent.
       * Swapping the two would leave a trade unlanded while the UI reported
       * success — the failure those two named functions were split to prevent.
       */
      async signAndLand({ order }) {
        const walletMod = await loadSolanaWallet();
        const sol = await loadSolana();
        if (order?.provider === 'jupiter') {
          const signed = await walletMod.signSolanaTransaction(order.transaction);
          const exec = await sol.executeSolanaOrder({ signedTransaction: signed, requestId: order.requestId });
          if (!sol.executeSucceeded(exec)) return { ok: false, code: sol.orderErrorKey(exec) || 'SEND_FAILED' };
          const signature = sol.executeSignature(exec);
          if (!signature) return { ok: false, code: 'NO_SIGNATURE' };
          return { ok: true, signature };
        }
        const signature = await walletMod.signAndSendSolana(order.transaction, order.versioned);
        return signature ? { ok: true, signature } : { ok: false, code: 'NO_SIGNATURE' };
      },
      executeSucceeded: (res) => solanaMod?.executeSucceeded?.(res) ?? (res?.status === 'Success' && Number(res?.code) === 0),
      executeSignature: (res) => solanaMod?.executeSignature?.(res) ?? (res?.signature || null),
      orderErrorKey: (res) => solanaMod?.orderErrorKey?.(res) || 'ORDER_FAILED',
      confirmSignature: async (signature) => (await loadSolanaWallet()).confirmSolanaSignature(signature)
    },

    /* ── risk + marks ─────────────────────────────────────────────────── */
    risk: {
      /* The venue's own model is the authority; when it is not loaded the
         honest answer is "unknown", never an approximation. */
      liquidationDistancePct: (args) => (typeof perpRiskMod?.liquidationDistancePct === 'function'
        ? perpRiskMod.liquidationDistancePct(args)
        : null)
    },

    market: {
      priceOf: typeof priceOf === 'function' ? priceOf : async () => null
    },

    warm: warmAutonomyDrivers,
    readiness: autonomyDriverReadiness,

    /** Which wallets this driver set can actually sign with. */
    wallets: {
      evm: Boolean(wallet?.connected),
      solana: Boolean(solana?.connected)
    }
  };

  /*
   * ── GATE EVERY VENUE ON WHAT ACTUALLY LOADED ───────────────────────────
   * `warmAutonomyDrivers` uses Promise.allSettled, so it never throws — a
   * module that failed to resolve leaves its cache slot null and warm() still
   * reports ok. The wrappers above are lazy closures, so they exist either
   * way, and an executor's `hasDrivers()` predicate (which checks for the
   * METHOD) was satisfied by a wrapper around a module that was never there.
   *
   * Measured, with the lending module unloaded:
   *   hasDrivers(lend-aave) === true, then runLendingPlan threw
   *   `Cannot find module '.../src/lib/chains'` — a raw TypeError from deep
   *   inside, where the design intends the named VENUE_DRIVER_MISSING. And
   *   equity.resolveAsset returned a silent null instead of refusing.
   *
   * So drop the namespace rather than hand over a hollow wrapper. The
   * executor then reports its own named failure at the gate, which is the
   * whole reason VENUE_DRIVER_MISSING exists.
   */
  const gates = {
    swap: swapMod && chainsMod,
    lending: lendingMod,
    aaveBase: aaveBaseMod,
    perp: perpMod && perpMarketsMod,
    equity: solanaMod && solanaWalletMod
  };
  for (const [venue, loaded] of Object.entries(gates)) {
    if (!loaded) drivers[venue] = {};
  }

  return drivers;
}
