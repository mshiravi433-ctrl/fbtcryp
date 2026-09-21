/**
 * SOLANA LAUNCH — the bonding-curve flow (Raydium LaunchLab).
 * ============================================================================
 * A dedicated wizard beside the EVM one: token identity → curve economics →
 * review (live config + cost + PDAs) → run (create, then the optional first
 * buy) → result (verified live, or a named failure with a safe retry).
 *
 * Honesty rules this flow enforces:
 *   · the curve bounds come from the LIVE config account, never from pinned
 *     values — the pinned API numbers are only placeholders;
 *   · the buy quote is refreshed from the LIVE pool state right before its
 *     wallet prompt (a stale minimum fails closed on-chain, but a fresh one
 *     fails never);
 *   · every transaction is simulated before its signature (see signing.js);
 *   · LIVE is claimed only after verifySolanaLaunch reconciles pool, mint,
 *     vaults and metadata with the plan;
 *   · the ephemeral mint keypair lives in a ref, never in state/storage, and
 *     is wiped once its job is done.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SolanaConnectSheet from './SolanaConnectSheet';
import { warmDeeplinkRequest } from '../lib/solana/deeplink.js';
import { useTranslation } from 'react-i18next';
/*
 * `Buffer` is a Node global; a browser does not have one. The PDA derivation
 * below seeds `findProgramAddressSync` with `Buffer.from('global_config')`, and
 * without this import that line threw a ReferenceError which the catch reported
 * as RPC_UNAVAILABLE — «دسترسی به RPC سولانا ممکن نیست» on a phone whose
 * connection was fine. See lib/launch/solana/launchlab.js for the full story.
 */
import { Buffer } from 'buffer';
import InfoBox from './InfoBox';
import {
  IconCheck, IconCoins, IconCopy, IconExternal, IconRefresh,
  IconRocket, IconShield, IconWallet, IconX
} from './Icons';
import { shortAddress } from '../context/WalletContext';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  connectSolana, disconnectSolana, solanaAddress, solanaWalletName,
  solanaWalletAvailable, canInjectSolana, phantomBrowseLink
} from '../lib/solanaWallet';
import {
  LAUNCHLAB_DEFAULTS, METAPLEX_LIMITS, WSOL_MINT,
  validateLaunchlabIdentity, checkCurveParams,
  deriveInitReserves, quoteBuyExactIn, minAmountOut,
  spotPriceText, endPriceText, buildDataUri,
  buildLaunchlabPlan, deriveLaunchpadAddresses,
  launchlabClusterConfig
} from '../lib/launch/solana/launchlab';
import {
  getSolanaLaunchConnection, solanaLaunchCluster, runLaunchLeg,
  estimateLaunchCost, wipeKeypair, LAUNCH_CREATE_COMPUTE_UNITS
} from '../lib/launch/solana/signing';
import { probeSolanaRpc } from '../lib/solanaRpc';
import {
  loadLaunchlabConfig, loadLaunchlabPlatform, verifySolanaLaunch
} from '../lib/launch/solana/verify';
import { recordLaunch } from '../lib/launch/history';

const SOL_STEPS = ['token', 'curve', 'review'];

/* Exact decimal → base units, string math only (no floats near money). */
function parseDecimalToBase(str, decimals) {
  const s = String(str ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [ip, fp = ''] = s.split('.');
  if (fp.length > decimals) return null;
  return BigInt(ip) * 10n ** BigInt(decimals) + BigInt((fp + '0'.repeat(decimals)).slice(0, decimals) || '0');
}
function baseToDecimalString(base, decimals) {
  const v = BigInt(base);
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(decimals + 1, '0');
  const head = s.slice(0, -decimals) || '0';
  const tail = decimals ? s.slice(-decimals).replace(/0+$/, '') : '';
  return (neg ? '-' : '') + head + (tail ? `.${tail}` : '');
}
const lamportsToSol = (l) => baseToDecimalString(l, 9);
/** Host only — naming the node that refused is useful, its query string is not. */
const hostOf = (url) => {
  try { return new URL(String(url)).host; } catch { return String(url || '').slice(0, 48); }
};
const numOnly = (s) => {
  const c = String(s ?? '').replace(/[^0-9.]/g, '');
  const i = c.indexOf('.');
  if (i === -1) return c.replace(/^0+(?=\d)/, '');
  return (c.slice(0, i + 1) + c.slice(i + 1).replace(/\./g, '')).replace(/^0+(?=\d)/, '');
};

/* ── Solana wallet (self-contained: the EVM connect sheet has no Solana) ── */
function useSolanaWallet() {
  const { t } = useTranslation();
  const [address, setAddress] = useState(() => solanaAddress());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    const onChange = (e) => setAddress(e?.detail?.address || solanaAddress());
    window.addEventListener('solana:wallet-change', onChange);
    setAddress(solanaAddress());
    /* Arm the connect request here, not at tap time: a hand-off that has to
       come out of a user gesture cannot wait for a `tweetnacl` chunk. */
    warmDeeplinkRequest();
    return () => window.removeEventListener('solana:wallet-change', onChange);
  }, []);
  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const a = await connectSolana();
      setAddress(a);
    } catch (e) {
      setError(String(e?.message || 'CONNECT_FAILED'));
    } finally {
      setBusy(false);
    }
  }, []);
  const disconnect = useCallback(async () => {
    await disconnectSolana().catch(() => {});
    setAddress(null);
  }, []);
  return { address, walletName: address ? solanaWalletName() : null, busy, error, connect, disconnect, t };
}

/*
 * ── live LaunchLab accounts (config + platform, re-read per review) ──────
 *
 * TWO THINGS THIS HOOK NOW SAYS OUT LOUD.
 *
 * 1 · WHICH NODE, AND WHY IT REFUSED.
 * The catch used to map EVERY throw to RPC_UNAVAILABLE — «دسترسی به RPC سولانا
 * ممکن نیست» — so a missing `Buffer` global, a throttled public node, a
 * censored host and a genuinely offline phone all produced the same sentence,
 * and the only advice on screen was "check your connection". The read is now
 * preceded by an explicit probe of the candidate list (lib/solanaRpc.js), which
 * names the failure: RATE_LIMITED (retry helps), TIMEOUT (retry may help),
 * UNREACHABLE (the network is blocking the host — retrying does not help, and
 * saying so is the difference between a user who waits and a user who switches
 * network). The endpoint that answered, or the list that did not, is kept so
 * the row can show it.
 *
 * 2 · THIS READ NEEDS NO WALLET.
 * Asked directly: «ببین برای چیه ایا بخاطر وصل نبودن کیف پوله» — is the error
 * because the wallet is not connected? It cannot be. Reading a config account
 * is a public JSON-RPC query; nothing in it is signed and no provider is
 * consulted. The green tick beside it is the WALLET being connected, which is
 * a separate check with a separate meaning — so the two now carry their own
 * labels instead of looking like one contradiction.
 */
const RPC_ERROR_CODES = Object.freeze({
  RATE_LIMITED: 'RPC_RATE_LIMITED',
  TIMEOUT: 'RPC_TIMEOUT',
  UNREACHABLE: 'RPC_BLOCKED',
  UNAVAILABLE: 'RPC_UNAVAILABLE'
});

function useLiveAccounts(cluster) {
  const [state, setState] = useState({
    loading: true, config: null, platform: null, error: null,
    endpoint: null, attempts: null, nonce: 0
  });
  const reload = useCallback(
    () => setState((s) => ({ ...s, loading: true, error: null, endpoint: null, attempts: null, nonce: s.nonce + 1 })),
    []
  );
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    (async () => {
      /* Probe FIRST: it picks the endpoint AND names the failure if none
         answers, which is the honest half of this screen. */
      const probe = await probeSolanaRpc({ cluster, signal: controller.signal });
      if (!alive) return;
      if (!probe.ok) {
        setState((s) => ({
          ...s,
          loading: false,
          error: RPC_ERROR_CODES[probe.reason] || 'RPC_UNAVAILABLE',
          attempts: probe.attempts || null
        }));
        return;
      }
      try {
        const connection = await getSolanaLaunchConnection();
        const cc = launchlabClusterConfig(cluster);
        const { PublicKey } = await import('@solana/web3.js');
        const prog = new PublicKey(cc.programId);
        const [configId] = PublicKey.findProgramAddressSync(
          [Buffer.from('global_config', 'utf8'), new PublicKey(WSOL_MINT).toBuffer(), Uint8Array.from([0]), Uint8Array.from([0, 0])],
          prog
        );
        const cfg = await loadLaunchlabConfig(connection, { cluster, programId: cc.programId, configId: configId.toBase58() });
        if (!cfg.ok) {
          if (alive) setState((s) => ({ ...s, loading: false, error: cfg.problems[0] || 'CONFIG_NOT_FOUND', endpoint: probe.url }));
          return;
        }
        const plat = await loadLaunchlabPlatform(connection, { programId: cc.programId, platformId: cc.platformId });
        if (alive) {
          setState((s) => ({
            ...s, loading: false, config: cfg.decoded,
            platform: plat.ok ? plat.decoded : null,
            platformProblems: plat.ok ? [] : plat.problems,
            error: null,
            endpoint: probe.url
          }));
        }
      } catch (e) {
        /* The node answered a health check and then failed the real read: say
           that, rather than repeating the unreachable-network line. */
        if (alive) {
          setState((s) => ({
            ...s, loading: false, error: 'RPC_READ_FAILED',
            endpoint: probe.url, detail: String(e?.message || e || '').slice(0, 160)
          }));
        }
      }
    })();
    return () => { alive = false; controller.abort(); };
  }, [cluster, state.nonce]);
  return { ...state, reload };
}

function CopyText({ text, label }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button" className={`launch-copy${copied ? ' done' : ''}`}
      aria-label={label || t('launch.result.copy')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch { /* clipboard unavailable — the text is still visible */ }
      }}
    >
      {copied ? <IconCheck width={13} height={13} /> : <IconCopy width={13} height={13} />}
    </button>
  );
}

export default function SolanaLaunchFlow({ onBack, onHistory }) {
  const { t } = useTranslation();
  const clusterSetting = useSettingsStore((s) => s.solanaCluster);
  const cluster = clusterSetting === 'devnet' ? 'devnet' : 'mainnet-beta';
  const wallet = useSolanaWallet();
  const live = useLiveAccounts(cluster);

  const [step, setStep] = useState(0);
  const [view, setView] = useState('wizard'); // wizard | running | result
  // token
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [uriMode, setUriMode] = useState('auto'); // auto | custom
  const [customUri, setCustomUri] = useState('');
  // curve
  const [supply, setSupply] = useState('1000000000');
  const [sellPct, setSellPct] = useState('79.31');
  const [raiseSol, setRaiseSol] = useState('85');
  const [firstBuySol, setFirstBuySol] = useState('');
  const [slippage, setSlippage] = useState(1);
  // review/run
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [cost, setCost] = useState(null);
  const [balance, setBalance] = useState(null); // lamports BigInt or null
  const [run, setRun] = useState(null); // {legs:[...], signatures, verify, error, done}
  const mintRef = useRef(null);
  const cancelRef = useRef(false);
  const runRefBusy = useRef(false);

  useEffect(() => () => wipeKeypair(mintRef.current), []);

  const uri = useMemo(() => {
    if (uriMode === 'custom') return customUri.trim();
    // Auto descriptor: trim the description until the whole URI fits Metaplex.
    let desc = description.trim();
    let out = buildDataUri({ name: name.trim(), symbol: symbol.trim().toUpperCase(), description: desc });
    while (out.length > METAPLEX_LIMITS.uri && desc.length > 0) {
      desc = desc.slice(0, Math.max(0, desc.length - 10));
      out = buildDataUri({ name: name.trim(), symbol: symbol.trim().toUpperCase(), description: desc });
    }
    return out;
  }, [uriMode, customUri, name, symbol, description]);

  const identity = useMemo(() => validateLaunchlabIdentity({ name, symbol, uri }), [name, symbol, uri]);

  const curveInputs = useMemo(() => {
    // Solana LaunchLab SPL tokens use 6 decimals. The input represents whole
    // tokens (e.g. 1B), which must be converted to base units (10^15) so that
    // checkCurveParams and on-chain instructions compare against the live
    // config's minSupplyA (also scaled by 10^decimals).
    const supplyBase = parseDecimalToBase(supply, 6);
    const pct = /^\d+(\.\d+)?$/.test(sellPct.trim()) ? Number(sellPct) : NaN;
    const raiseLamports = parseDecimalToBase(raiseSol, 9);
    const buyLamports = firstBuySol.trim() === '' ? 0n : parseDecimalToBase(firstBuySol, 9);
    const sellBase = supplyBase != null && Number.isFinite(pct) ? (supplyBase * BigInt(Math.round(pct * 100))) / 10000n : null;
    return { supplyBase, pct, raiseLamports, buyLamports, sellBase };
  }, [supply, sellPct, raiseSol, firstBuySol]);

  const curveCheck = useMemo(() => {
    const { supplyBase, sellBase, raiseLamports, buyLamports, pct } = curveInputs;
    if (supplyBase == null || sellBase == null || raiseLamports == null || buyLamports == null || !Number.isFinite(pct)) {
      return { ok: false, problems: ['PARAMS_UNPARSEABLE'], local: true };
    }
    if (!live.config) return { ok: false, problems: ['CONFIG_LOADING'], local: true };
    return checkCurveParams({
      supply: supplyBase, totalSellA: sellBase, totalFundRaisingB: raiseLamports,
      totalLockedAmount: 0n, decimals: 6, config: live.config, migrateType: 'cpmm'
    });
  }, [curveInputs, live.config]);

  // Live first-buy preview on the curve step (needs platform rates).
  const buyPreview = useMemo(() => {
    try {
      const { supplyBase, sellBase, raiseLamports, buyLamports } = curveInputs;
      if (!live.config || !live.platform || supplyBase == null || sellBase == null || raiseLamports == null) return null;
      if (buyLamports == null || buyLamports <= 0n) return null;
      const r = deriveInitReserves({
        supply: supplyBase, totalSell: sellBase, totalLockedAmount: 0n,
        totalFundRaising: raiseLamports, migrateFee: live.config.migrateFee ?? 0n
      });
      const rate = BigInt(live.config.tradeFeeRate) + BigInt(live.platform.feeRate) + BigInt(live.platform.creatorFeeRate);
      const q = quoteBuyExactIn({ virtualA: r.virtualA, virtualB: r.virtualB, amountB: buyLamports, totalFeeRate: rate, totalSellA: sellBase });
      return {
        out: baseToDecimalString(q.amountOut, 6),
        fee: lamportsToSol(q.fee),
        min: baseToDecimalString(minAmountOut(q.amountOut, Math.round(slippage * 100)), 6),
        capped: q.capped
      };
    } catch {
      return null;
    }
  }, [curveInputs, live.config, live.platform, slippage]);

  const econPreview = useMemo(() => {
    try {
      const { supplyBase, sellBase, raiseLamports } = curveInputs;
      if (!live.config || supplyBase == null || sellBase == null || raiseLamports == null) return null;
      const r = deriveInitReserves({
        supply: supplyBase, totalSell: sellBase, totalLockedAmount: 0n,
        totalFundRaising: raiseLamports, migrateFee: live.config.migrateFee ?? 0n
      });
      return {
        initPrice: spotPriceText({ virtualA: r.virtualA, virtualB: r.virtualB, decimalA: 6, decimalB: 9 }),
        endPrice: endPriceText({
          supply: supplyBase, totalSell: sellBase, totalFundRaising: raiseLamports,
          migrateFee: live.config.migrateFee ?? 0n, decimalA: 6, decimalB: 9
        })
      };
    } catch {
      return null;
    }
  }, [curveInputs, live.config]);

  // ── review loader: fresh mint keypair + full plan + cost + balance ──────
  const planKey = JSON.stringify([cluster, name, symbol, uri, supply, sellPct, raiseSol, firstBuySol, slippage, wallet.address, live.config?.epoch, live.platform?.feeRate]);
  const loadReview = useCallback(async () => {
    if (!identity.ok || !curveCheck.ok || !wallet.address || !live.config) return;
    setPlanning(true);
    setPlanError(null);
    setPlan(null);
    setCost(null);
    try {
      const { Keypair } = await import('@solana/web3.js');
      wipeKeypair(mintRef.current);
      mintRef.current = Keypair.generate();
      const connection = await getSolanaLaunchConnection();
      const { buyLamports } = curveInputs;
      if (buyLamports > 0n && !live.platform) throw new Error('PLATFORM_NOT_FOUND');
      const p = await buildLaunchlabPlan({
        cluster, creator: wallet.address, mintKeypair: mintRef.current,
        name: identity.value.name, symbol: identity.value.symbol, uri: identity.value.uri,
        decimals: 6, supply: curveInputs.supplyBase, totalSellA: curveInputs.sellBase,
        totalFundRaisingB: curveInputs.raiseLamports, config: live.config,
        platform: buyLamports > 0n ? live.platform : null,
        firstBuyLamports: buyLamports, slippageBps: Math.round(slippage * 100)
      });
      setPlan(p);
      try {
        setCost(await estimateLaunchCost({ connection, payer: wallet.address, plan: p }));
      } catch {
        setCost({ ok: false });
      }
      try {
        const { PublicKey } = await import('@solana/web3.js');
        setBalance(BigInt(await connection.getBalance(new PublicKey(wallet.address), 'confirmed')));
      } catch {
        setBalance(null);
      }
    } catch (e) {
      setPlanError(String(e?.message || 'PLAN_FAILED'));
    } finally {
      setPlanning(false);
    }
  }, [identity, curveCheck, wallet.address, live.config, live.platform, curveInputs, cluster, slippage]);

  const [loadedKey, setLoadedKey] = useState(null);
  useEffect(() => {
    if (view === 'wizard' && step === 2 && planKey !== loadedKey && !planning) {
      setLoadedKey(planKey);
      loadReview();
    }
  }, [view, step, planKey, loadedKey, planning, loadReview]);

  const totalNeeded = useMemo(() => {
    if (!cost?.ok) return null;
    return BigInt(cost.rentLamports) + BigInt(cost.createFeeLamports)
      + BigInt(cost.buyFeeLamports) + BigInt(cost.buyAtaRentLamports)
      + BigInt(cost.firstBuyLamports);
  }, [cost]);
  const fundsOk = totalNeeded == null || balance == null ? null : balance >= totalNeeded;

  const canNext = step === 0 ? identity.ok : step === 1 ? curveCheck.ok : false;
  const launchReady = Boolean(plan && cost?.ok && fundsOk !== false && wallet.address && !planning);

  // ── execution ─────────────────────────────────────────────────────────
  const setLeg = (id, patch) => setRun((r) => r ? {
    ...r, legs: r.legs.map((l) => (l.id === id ? { ...l, ...patch } : l))
  } : r);

  const refreshBuyItems = useCallback(async (connection, basePlan) => {
    // Re-quote the buy from the LIVE pool state right before its prompt: the
    // review quote assumed an untouched curve, and anything that moved it
    // since (even our own create's timing) must not strand the buy on a
    // stale minimum. A lower-or-equal min is the only safe direction, and
    // the pool read proves which it is.
    const { PublicKey } = await import('@solana/web3.js');
    const { decodeLaunchpadPool } = await import('../lib/launch/solana/launchlab.js');
    const info = await connection.getAccountInfo(new PublicKey(basePlan.addresses.poolId), 'confirmed');
    if (!info) throw new Error('POOL_ACCOUNT_MISSING');
    const pool = decodeLaunchpadPool(info.data);
    const rate = BigInt(live.config.tradeFeeRate) + BigInt(live.platform.feeRate) + BigInt(live.platform.creatorFeeRate);
    const amountB = BigInt(basePlan.economics.firstBuy.lamports);
    const q = quoteBuyExactIn({
      virtualA: BigInt(pool.virtualA), virtualB: BigInt(pool.virtualB),
      realA: BigInt(pool.realA), realB: BigInt(pool.realB),
      amountB, totalFeeRate: rate, totalSellA: BigInt(pool.totalSellA)
    });
    if (q.capped) throw new Error('FIRST_BUY_EXCEEDS_CURVE');
    const minOut = minAmountOut(q.amountOut, Math.round(slippage * 100));
    const { buildBuyExactIn } = await import('../lib/launch/solana/launchlab.js');
    const fresh = await buildBuyExactIn({
      programId: basePlan.programId, owner: basePlan.addresses.creator, auth: basePlan.addresses.auth,
      configId: basePlan.addresses.configId, platformId: basePlan.addresses.platformId, poolId: basePlan.addresses.poolId,
      userTokenAccountA: basePlan.buy.userTokenAccountA, userTokenAccountB: basePlan.buy.userTokenAccountB,
      vaultA: basePlan.addresses.vaultA, vaultB: basePlan.addresses.vaultB,
      mintA: basePlan.addresses.mintA, mintB: WSOL_MINT,
      platformClaimFeeVault: basePlan.addresses.platformFeeVault,
      creatorClaimFeeVault: basePlan.addresses.creatorFeeVault,
      amountB, minAmountA: minOut
    });
    const items = basePlan.buy.items.map((it) => (it.id === 'launchlab-buy' ? fresh : it));
    return { items, quotedOut: q.amountOut.toString(), minOut: minOut.toString(), realA: pool.realA, realB: pool.realB };
  }, [live.config, live.platform, slippage]);

  const startLaunch = useCallback(async () => {
    if (!launchReady || !plan || runRefBusy.current) return;
    runRefBusy.current = true;
    cancelRef.current = false;
    const legs = [
      { id: 'create', status: 'ready', stage: null, signature: null, error: null },
      ...(plan.buy ? [{ id: 'buy', status: 'ready', stage: null, signature: null, error: null }] : []),
      { id: 'verify', status: 'ready', stage: null, signature: null, error: null }
    ];
    setRun({ legs, signatures: {}, facts: null, error: null, done: false, state: 'RUNNING' });
    setView('running');
    try {
      const connection = await getSolanaLaunchConnection();
      const clusterNow = await solanaLaunchCluster();
      const sigs = {};
      // leg 1 — create
      setLeg('create', { status: 'signing', stage: 'simulating' });
      let createSig;
      try {
        const done = await runLaunchLeg({
          connection, cluster: clusterNow, payer: wallet.address,
          items: plan.create.items, extraSigners: [mintRef.current],
          computeUnits: LAUNCH_CREATE_COMPUTE_UNITS,
          onStage: (stage) => setLeg('create', { stage })
        });
        createSig = done.signature;
      } catch (e) {
        setLeg('create', { status: 'failed', error: String(e?.message || 'CREATE_FAILED'), signature: e?.signature || null });
        setRun((r) => ({ ...r, done: true, state: 'FAILED', error: String(e?.message || 'CREATE_FAILED') }));
        setView('result');
        return;
      }
      sigs.create = createSig;
      setLeg('create', { status: 'confirmed', signature: createSig, stage: null });
      setRun((r) => ({ ...r, signatures: { ...r.signatures, create: createSig } }));
      if (cancelRef.current) {
        setRun((r) => ({ ...r, done: true, state: 'CANCELLED' }));
        setView('result');
        return;
      }
      // leg 2 — first buy (quote refreshed from the live pool first)
      if (plan.buy) {
        setLeg('buy', { status: 'signing', stage: 'refreshing' });
        let buyItems = plan.buy.items;
        try {
          const fresh = await refreshBuyItems(connection, plan);
          buyItems = fresh.items;
          setRun((r) => ({ ...r, buyRefresh: fresh }));
        } catch (e) {
          setLeg('buy', { status: 'failed', error: String(e?.message || 'BUY_QUOTE_FAILED') });
          setRun((r) => ({ ...r, done: true, state: 'BUY_FAILED', error: String(e?.message || 'BUY_QUOTE_FAILED') }));
          setView('result');
          return;
        }
        try {
          const done = await runLaunchLeg({
            connection, cluster: clusterNow, payer: wallet.address, items: buyItems,
            extraSigners: [], computeUnits: 0,
            onStage: (stage) => setLeg('buy', { stage })
          });
          sigs.buy = done.signature;
          setLeg('buy', { status: 'confirmed', signature: done.signature, stage: null });
          setRun((r) => ({ ...r, signatures: { ...r.signatures, buy: done.signature } }));
        } catch (e) {
          setLeg('buy', { status: 'failed', error: String(e?.message || 'BUY_FAILED'), signature: e?.signature || null });
          setRun((r) => ({ ...r, done: true, state: 'BUY_FAILED', error: String(e?.message || 'BUY_FAILED') }));
          setView('result');
          return;
        }
      }
      // leg 3 — verify against the chain before claiming LIVE
      setLeg('verify', { status: 'signing', stage: 'reading' });
      const vres = await verifySolanaLaunch({ connection, plan, signatures: sigs }).catch(() => null);
      if (vres?.ok) {
        setLeg('verify', { status: 'confirmed', stage: null });
        const facts = vres.facts;
        setRun((r) => ({ ...r, done: true, state: 'LIVE', facts }));
        recordLaunch({
          launchId: `sol-${Date.now()}`,
          creatorPublicAddress: wallet.address,
          network: 'solana',
          networkName: 'Solana',
          tokenAddress: facts.token.address,
          poolAddress: facts.pool.address,
          tokenName: facts.token.name,
          symbol: facts.token.symbol,
          supply,
          initialPrice: plan.economics.initPrice,
          tokenLiquidity: null,
          quoteLiquidity: raiseSol,
          quoteSymbol: 'SOL',
          provider: 'raydium-launchlab',
          status: 'LIVE',
          riskScore: null,
          txHashes: [createSig],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        onHistory?.();
      } else {
        const problems = vres?.problems || ['VERIFY_UNREADABLE'];
        setLeg('verify', { status: 'failed', error: problems.join(',') });
        setRun((r) => ({ ...r, done: true, state: 'VERIFY_FAILED', error: problems.join(','), facts: vres?.facts || null }));
      }
      setView('result');
    } finally {
      runRefBusy.current = false;
      wipeKeypair(mintRef.current);
    }
  }, [launchReady, plan, wallet.address, refreshBuyItems, raiseSol, supply, onHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  const retryBuyOnly = useCallback(async () => {
    if (!plan?.buy || runRefBusy.current) return;
    runRefBusy.current = true;
    try {
      setView('running');
      setRun((r) => ({
        ...r, done: false, state: 'RUNNING', error: null,
        legs: r.legs.map((l) => (l.id === 'buy' ? { ...l, status: 'signing', stage: 'refreshing', error: null } : l))
      }));
      const connection = await getSolanaLaunchConnection();
      const clusterNow = await solanaLaunchCluster();
      const fresh = await refreshBuyItems(connection, plan);
      const done = await runLaunchLeg({
        connection, cluster: clusterNow, payer: wallet.address, items: fresh.items,
        extraSigners: [], computeUnits: 0,
        onStage: (stage) => setLeg('buy', { stage })
      });
      setLeg('buy', { status: 'confirmed', signature: done.signature, stage: null });
      setLeg('verify', { status: 'signing', stage: 'reading' });
      const vres = await verifySolanaLaunch({ connection, plan, signatures: { ...run.signatures, buy: done.signature } }).catch(() => null);
      if (vres?.ok) {
        setLeg('verify', { status: 'confirmed', stage: null });
        setRun((r) => ({ ...r, done: true, state: 'LIVE', facts: vres.facts, signatures: { ...r.signatures, buy: done.signature } }));
      } else {
        setLeg('verify', { status: 'failed', error: (vres?.problems || ['VERIFY_UNREADABLE']).join(',') });
        setRun((r) => ({ ...r, done: true, state: 'VERIFY_FAILED', error: (vres?.problems || ['VERIFY_UNREADABLE']).join(',') }));
      }
      setView('result');
    } catch (e) {
      setLeg('buy', { status: 'failed', error: String(e?.message || 'BUY_FAILED') });
      setRun((r) => ({ ...r, done: true, state: 'BUY_FAILED', error: String(e?.message || 'BUY_FAILED') }));
      setView('result');
    } finally {
      runRefBusy.current = false;
    }
  }, [plan, wallet.address, refreshBuyItems, run?.signatures]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── render ────────────────────────────────────────────────────────────
  const explorerFor = (kind, addr) => `${plan?.explorer || launchlabClusterConfig(cluster).explorer}/${kind}/${addr}`;
  const cfg = live.config;

  return (
    <div className="launch-flow">
      <div className="launch-sol-head">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          {t('launch.back')}
        </button>
        <span className={`launch-cluster-pill ${cluster}`}>
          <span className="launch-status-dot" aria-hidden />
          {cluster === 'devnet' ? t('launch.sol.clusterDevnet') : t('launch.sol.clusterMainnet')}
        </span>
      </div>

      {view === 'wizard' && (
        <>
          <div className="launch-stepper" role="tablist" aria-label={t('launch.steps')}>
            {SOL_STEPS.map((s, i) => (
              <button
                key={s} type="button" role="tab" aria-selected={step === i}
                className={`launch-step${step === i ? ' active' : ''}${i < step ? ' done' : ''}`}
                onClick={() => { if (i < step) setStep(i); }}
                disabled={i > step}
              >
                <span className="launch-step-num">{i < step ? <IconCheck width={12} height={12} /> : i + 1}</span>
                <span className="launch-step-label">{t(`launch.sol.step.${s}`)}</span>
              </button>
            ))}
          </div>

          {cluster === 'devnet' && (
            <InfoBox tone="warn" title={t('launch.sol.devnetTitle')}>
              {t('launch.sol.devnetBody')}
            </InfoBox>
          )}

          {live.loading && (
            <div className="launch-dexcheck checking" role="status">
              <span className="launch-dexcheck-ico" aria-hidden><span className="spinner spinner-sm" /></span>
              <span className="launch-dexcheck-text">{t('launch.sol.readingConfig')}</span>
            </div>
          )}
          {!live.loading && live.error && (
            <div className="launch-dexcheck bad" role="status">
              <span className="launch-dexcheck-ico" aria-hidden><IconShield width={15} height={15} /></span>
              <span className="launch-dexcheck-text">
                {t(`launch.sol.err.${live.error}`, { defaultValue: live.error })}
                {/*
                  The two lines below are the answer to «ببین برای چیه» — why
                  this happens and what it is NOT. A node list nobody can see
                  makes a throttle indistinguishable from a dead feature, and
                  blaming the wallet for a public read sends the user to fix
                  the one thing that was never broken.
                */}
                <small className="launch-dexcheck-note">
                  {t('launch.sol.rpcNoWalletNote')}
                  {live.attempts?.length
                    ? ` · ${live.attempts.map((a) => hostOf(a.url)).join(' ، ')}`
                    : live.endpoint ? ` · ${hostOf(live.endpoint)}` : ''}
                </small>
                {live.detail ? <small className="launch-dexcheck-note mono" dir="ltr">{live.detail}</small> : null}
              </span>
              <button type="button" className="launch-dexcheck-retry" onClick={live.reload}>
                <IconRefresh width={13} height={13} aria-hidden /> {t('launch.network.retry')}
              </button>
            </div>
          )}
          {!live.loading && !live.error && cfg && (
            <div className="launch-dexcheck ok" role="status">
              <span className="launch-dexcheck-ico" aria-hidden><IconCheck width={15} height={15} /></span>
              <span className="launch-dexcheck-text">
                {t('launch.sol.configFound', { fee: (Number(cfg.tradeFeeRate) / 10000).toFixed(2) })}
                {/* Which node vouched for those numbers — the same transparency
                    the failure row has, on the success row. */}
                {live.endpoint ? <small className="launch-dexcheck-note mono" dir="ltr">{hostOf(live.endpoint)}</small> : null}
              </span>
            </div>
          )}

          {step === 0 && (
            <section className="launch-section">
              <h2 className="launch-h2">{t('launch.sol.tokenTitle')}</h2>
              <div className="launch-token-card">
                <div className="launch-field">
                  <label className="field-label">{t('launch.token.name')} · {name.trim().length}/{METAPLEX_LIMITS.name}</label>
                  <input className="launch-input" value={name} maxLength={METAPLEX_LIMITS.name}
                    placeholder={t('launch.token.namePh')}
                    onChange={(e) => setName(e.target.value)} autoCapitalize="off" spellCheck={false} />
                </div>
                <div className="launch-field">
                  <label className="field-label">{t('launch.token.symbol')} · {symbol.trim().length}/{METAPLEX_LIMITS.symbol}</label>
                  <input className="launch-input" value={symbol} maxLength={METAPLEX_LIMITS.symbol}
                    placeholder={t('launch.token.symbolPh')}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())} autoCapitalize="characters" spellCheck={false} />
                  <p className="launch-hint">{t('launch.sol.symbolNote')}</p>
                </div>
                <div className="launch-field">
                  <label className="field-label">{t('launch.token.description')}</label>
                  <textarea className="launch-input launch-textarea" rows={2} maxLength={120} value={description}
                    onChange={(e) => setDescription(e.target.value)} />
                </div>
                <div className="launch-field">
                  <label className="field-label">{t('launch.sol.uriTitle')}</label>
                  <div className="launch-seg" role="tablist" aria-label={t('launch.sol.uriTitle')}>
                    <button type="button" role="tab" aria-selected={uriMode === 'auto'}
                      className={`launch-seg-btn${uriMode === 'auto' ? ' active' : ''}`}
                      onClick={() => setUriMode('auto')}>
                      {t('launch.sol.uriAuto')}
                    </button>
                    <button type="button" role="tab" aria-selected={uriMode === 'custom'}
                      className={`launch-seg-btn${uriMode === 'custom' ? ' active' : ''}`}
                      onClick={() => setUriMode('custom')}>
                      {t('launch.sol.uriCustom')}
                    </button>
                  </div>
                  {uriMode === 'auto' ? (
                    <p className="launch-hint">{t('launch.sol.uriAutoNote', { n: uri.length, max: METAPLEX_LIMITS.uri })}</p>
                  ) : (
                    <input className="launch-input mono" value={customUri} maxLength={METAPLEX_LIMITS.uri}
                      placeholder="https://…" onChange={(e) => setCustomUri(e.target.value)}
                      autoCapitalize="off" spellCheck={false} dir="ltr" />
                  )}
                </div>
              </div>
              {!identity.ok && (
                <div className="launch-errors">
                  {identity.problems.map((er) => <span key={er} className="launch-error-chip">{t(`launch.sol.err.${er}`)}</span>)}
                </div>
              )}
              <InfoBox tone="info" title={t('launch.sol.fixedRulesTitle')}>
                {t('launch.sol.fixedRulesBody')}
              </InfoBox>
            </section>
          )}

          {step === 1 && (
            <section className="launch-section">
              <h2 className="launch-h2">{t('launch.sol.curveTitle')}</h2>
              <div className="launch-amount-card">
                <div className="launch-amount">
                  <div className="launch-amount-head">
                    <label className="field-label" htmlFor="sol-supply">{t('launch.sol.supply')}</label>
                  </div>
                  <div className="launch-amount-box">
                    <input id="sol-supply" className="launch-amount-input mono" inputMode="numeric"
                      value={supply} onChange={(e) => setSupply(numOnly(e.target.value).split('.')[0])} />
                    <span className="launch-amount-sym">{symbol || 'TOKEN'}</span>
                  </div>
                  <p className="launch-hint">
                    {cfg ? t('launch.sol.supplyMin', { n: Number(cfg.minSupplyA).toLocaleString() }) : t('launch.sol.boundsLoading')}
                  </p>
                </div>
                <div className="launch-amount">
                  <div className="launch-amount-head">
                    <label className="field-label" htmlFor="sol-sell">{t('launch.sol.sellPct')}</label>
                    <span className="launch-slip-val mono">{sellPct}%</span>
                  </div>
                  <input id="sol-sell" type="range" min={20} max={85} step={0.01} value={Math.min(85, Math.max(20, Number(sellPct) || 20))}
                    onChange={(e) => setSellPct(e.target.value)} className="launch-range"
                    aria-label={t('launch.sol.sellPct')} />
                  <p className="launch-hint">
                    {cfg ? t('launch.sol.sellBounds', {
                      min: (Number(cfg.minSellRateA) / 10000).toFixed(0),
                      max: (100 - Number(cfg.minMigrateRateA) / 10000).toFixed(0)
                    }) : t('launch.sol.boundsLoading')}
                  </p>
                </div>
                <div className="launch-amount">
                  <div className="launch-amount-head">
                    <label className="field-label" htmlFor="sol-raise">{t('launch.sol.raise')}</label>
                  </div>
                  <div className="launch-amount-box">
                    <input id="sol-raise" className="launch-amount-input mono" inputMode="decimal"
                      value={raiseSol} onChange={(e) => setRaiseSol(numOnly(e.target.value))} />
                    <span className="launch-amount-sym">SOL</span>
                  </div>
                  <p className="launch-hint">
                    {cfg ? t('launch.sol.raiseMin', { n: lamportsToSol(BigInt(cfg.minFundRaisingB)) }) : t('launch.sol.boundsLoading')}
                  </p>
                </div>
                <div className="launch-amount">
                  <div className="launch-amount-head">
                    <label className="field-label" htmlFor="sol-buy">{t('launch.sol.firstBuy')}</label>
                  </div>
                  <div className="launch-amount-box">
                    <input id="sol-buy" className="launch-amount-input mono" inputMode="decimal"
                      value={firstBuySol} placeholder={t('launch.sol.firstBuyPh')}
                      onChange={(e) => setFirstBuySol(numOnly(e.target.value))} />
                    <span className="launch-amount-sym">SOL</span>
                  </div>
                  {buyPreview && !buyPreview.capped && (
                    <p className="launch-hint">
                      {t('launch.sol.buyQuote', { out: buyPreview.out, sym: symbol || 'TOKEN', fee: buyPreview.fee, min: buyPreview.min })}
                    </p>
                  )}
                  {buyPreview?.capped && <p className="launch-hint">{t('launch.sol.err.FIRST_BUY_EXCEEDS_CURVE')}</p>}
                </div>
              </div>
              <div className="launch-field">
                <div className="launch-amount-head">
                  <label className="field-label">{t('launch.liq.slippage')}</label>
                  <span className="launch-slip-val mono">{slippage}%</span>
                </div>
                <div className="launch-pct-row slip">
                  {[0.5, 1, 3].map((p) => (
                    <button key={p} type="button" className={`launch-pct${slippage === p ? ' active' : ''}`}
                      onClick={() => setSlippage(p)}>{p}%</button>
                  ))}
                </div>
                <input type="range" min={0.5} max={10} step={0.5} value={slippage}
                  onChange={(e) => setSlippage(Number(e.target.value))} className="launch-range"
                  aria-label={t('launch.liq.slippage')} />
              </div>
              {econPreview && (
                <div className="launch-liq-summary">
                  <div className="launch-liq-row">
                    <span>{t('launch.sol.initPrice')}</span>
                    <span className="mono">{econPreview.initPrice} SOL</span>
                  </div>
                  <div className="launch-liq-row">
                    <span>{t('launch.sol.endPrice')}</span>
                    <span className="mono">{econPreview.endPrice} SOL</span>
                  </div>
                </div>
              )}
              {!curveCheck.ok && !curveCheck.local && (
                <div className="launch-errors">
                  {curveCheck.problems.map((er) => <span key={er} className="launch-error-chip">{t(`launch.sol.err.${er}`)}</span>)}
                </div>
              )}
              <InfoBox tone="info" title={t('launch.sol.curveHowTitle')}>
                {t('launch.sol.curveHowBody')}
              </InfoBox>
            </section>
          )}

          {step === 2 && (
            <section className="launch-section">
              <h2 className="launch-h2">{t('launch.review.title')}</h2>
              {planning && (
                <div className="launch-dexcheck checking" role="status">
                  <span className="launch-dexcheck-ico" aria-hidden><span className="spinner spinner-sm" /></span>
                  <span className="launch-dexcheck-text">{t('launch.sol.planning')}</span>
                </div>
              )}
              {planError && (
                <div className="launch-alert warn" role="alert">
                  <span className="launch-alert-ico" aria-hidden><IconShield width={16} height={16} /></span>
                  <div className="launch-alert-body">
                    <p className="launch-alert-title">{t(`launch.sol.err.${planError}`, { defaultValue: planError })}</p>
                    <div className="launch-alert-text">{t('launch.sol.planErrorBody')}</div>
                  </div>
                </div>
              )}
              {plan && (
                <div className="launch-review-card">
                  <div className="launch-review-hero">
                    <div className="launch-review-id">
                      <p className="launch-review-name">{plan.identity.name} <span className="launch-review-sym">{plan.identity.symbol}</span></p>
                      <p className="launch-review-sub">Solana · Raydium LaunchLab · {plan.cluster}</p>
                    </div>
                  </div>
                  <ReviewRow k={t('launch.sol.mintAddr')} v={plan.addresses.mintA} mono copy />
                  <ReviewRow k={t('launch.sol.poolAddr')} v={plan.addresses.poolId} mono copy />
                  <ReviewRow k={t('launch.review.supply')} v={`${baseToDecimalString(BigInt(plan.params.supply), 6)} ${plan.identity.symbol}`} mono />
                  <ReviewRow k={t('launch.sol.sellRow')} v={`${baseToDecimalString(BigInt(plan.params.totalSellA), 6)} (${sellPct}%)`} mono />
                  <ReviewRow k={t('launch.sol.raiseRow')} v={`${lamportsToSol(BigInt(plan.params.totalFundRaisingB))} SOL`} mono />
                  <ReviewRow k={t('launch.sol.initPrice')} v={`1 ${plan.identity.symbol} = ${plan.economics.initPrice} SOL`} mono />
                  <ReviewRow k={t('launch.sol.endPrice')} v={`1 ${plan.identity.symbol} = ${plan.economics.endPrice} SOL`} mono />
                  {plan.economics.firstBuy && (
                    <ReviewRow k={t('launch.sol.firstBuyRow')} v={`${lamportsToSol(BigInt(plan.economics.firstBuy.lamports))} SOL → ≥ ${baseToDecimalString(BigInt(plan.economics.firstBuy.minOut), 6)} ${plan.identity.symbol}`} mono />
                  )}
                  <ReviewRow k={t('launch.sol.feeRow')} v={`${((Number(cfg.tradeFeeRate) + Number(live.platform?.feeRate || 0) + Number(live.platform?.creatorFeeRate || 0)) / 10000).toFixed(2)}%`} mono />
                  <ReviewRow
                    k={t('launch.sol.costRow')}
                    v={cost?.ok
                      ? `≤ ${lamportsToSol(BigInt(cost.rentLamports) + BigInt(cost.createFeeLamports) + BigInt(cost.buyFeeLamports) + BigInt(cost.buyAtaRentLamports))} SOL + ${lamportsToSol(BigInt(cost.firstBuyLamports))} SOL ${t('launch.sol.firstBuyWord')}`
                      : t('launch.sol.costUnknown')}
                    mono
                  />
                  <ReviewRow k={t('launch.review.signatures')} v={plan.buy ? '2' : '1'} />
                </div>
              )}
              {wallet.address && cost?.ok && fundsOk === false && (
                <div className="launch-alert warn" role="alert">
                  <span className="launch-alert-ico" aria-hidden><IconWallet width={16} height={16} /></span>
                  <div className="launch-alert-body">
                    <p className="launch-alert-title">{t('launch.sol.noFunds')}</p>
                    <div className="launch-alert-text">
                      {t('launch.sol.noFundsBody', { need: totalNeeded != null ? lamportsToSol(totalNeeded) : '?', have: balance != null ? lamportsToSol(balance) : '?' })}
                    </div>
                  </div>
                </div>
              )}
              <InfoBox tone="info" title={t('launch.sol.custodyTitle')}>
                {t('launch.sol.custodyBody')}
              </InfoBox>
              {!wallet.address ? (
                <SolConnectCard wallet={wallet} />
              ) : (
                <div className="launch-wallet-ok">
                  <span className="launch-wallet-ok-ico" aria-hidden><IconCheck width={13} height={13} /></span>
                  <span className="launch-wallet-ok-text">
                    {/*
                      Labelled on purpose. An unlabelled green tick beside a red
                      node error reads as one contradicting itself; naming each
                      check makes them two facts — «wallet connected» and «node
                      unreachable» — which can both be true at once.
                    */}
                    <b className="launch-wallet-ok-kind">{t('launch.sol.walletOkLabel')}</b>
                    {wallet.walletName || 'Solana'} · <span className="mono">{shortAddress(wallet.address)}</span>
                  </span>
                  <button type="button" className="launch-wallet-ok-change" onClick={wallet.disconnect}>
                    {t('launch.review.changeWallet')}
                  </button>
                </div>
              )}
              <div className="btn-row">
                <button type="button" className="btn btn-ghost" onClick={() => setStep(1)} disabled={planning}>
                  {t('launch.back')}
                </button>
                <button type="button" className="btn btn-primary launch-cta"
                  onClick={() => (wallet.address ? startLaunch() : wallet.connect())}
                  disabled={Boolean(wallet.address) && !launchReady}>
                  {planning ? <span className="spinner spinner-sm" /> : <IconRocket width={16} height={16} />}
                  {wallet.address ? t('launch.review.launch') : t('launch.review.connectWallet')}
                </button>
              </div>
            </section>
          )}

          {step < 2 && (
            <div className="btn-row launch-nav">
              <button type="button" className="btn btn-ghost" onClick={() => (step === 0 ? onBack() : setStep(step - 1))}>
                {t('launch.back')}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setStep(step + 1)} disabled={!canNext}>
                {t('launch.next')}
              </button>
            </div>
          )}
        </>
      )}

      {view === 'running' && run && (
        <div className="launch-run">
          <h2 className="launch-h2">{t('launch.run.title')}</h2>
          {plan && (
            <div className="launch-predicted">
              <p className="launch-predicted-title">{t('launch.sol.mintAddr')}</p>
              <p className="launch-predicted-addr mono">{plan.addresses.mintA}</p>
            </div>
          )}
          <ol className="launch-run-list">
            {run.legs.map((l) => (
              <li key={l.id} className={`launch-run-step ${l.status}`}>
                <span className="launch-run-ico" aria-hidden>
                  {l.status === 'confirmed' ? <IconCheck width={13} height={13} />
                    : l.status === 'failed' ? <IconX width={13} height={13} />
                      : l.status === 'signing' ? <span className="spinner spinner-sm" />
                        : <span className="launch-run-dot" />}
                </span>
                <div className="launch-run-info">
                  <p className="launch-run-name">{t(`launch.sol.leg.${l.id}`)}</p>
                  {l.error
                    ? <p className="launch-run-desc err">{t(`launch.sol.err.${String(l.error).split(':')[0]}`, { defaultValue: l.error })}</p>
                    : <p className="launch-run-desc">{l.stage ? t(`launch.sol.stage.${l.stage}`) : t(`launch.run.state.${l.status}`)}</p>}
                  {l.signature && (
                    <a className="launch-run-hash mono" href={explorerFor('tx', l.signature)} target="_blank" rel="noreferrer">
                      {shortAddress(l.signature, 6)} <IconExternal width={11} height={11} aria-hidden />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="launch-hint">{t('launch.sol.signNote')}</p>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={() => { cancelRef.current = true; }}>
              {t('launch.run.cancel')}
            </button>
          </div>
        </div>
      )}

      {view === 'result' && run && (
        <SolResult
          run={run} plan={plan} explorerFor={explorerFor}
          onRetryBuy={retryBuyOnly} onRestart={() => { setView('wizard'); setStep(2); setLoadedKey(null); }}
          onBack={onBack} t={t}
        />
      )}
    </div>
  );
}

function ReviewRow({ k, v, mono = false, copy = false }) {
  return (
    <div className="launch-review-row">
      <span className="launch-review-k">{k}</span>
      <span className={`launch-review-v${mono ? ' mono' : ''}`}>
        <span className="launch-review-addr">{v}</span>
        {copy && <CopyText text={v} label={k} />}
      </span>
    </div>
  );
}

function SolConnectCard({ wallet }) {
  const { t } = useTranslation();
  const pageUrl = typeof window !== 'undefined' ? window.location.href : '';
  const inWalletBrowser = solanaWalletAvailable();
  /*
   * The launch wizard asks the wallet for approval HERE, through the same
   * sheet the wallet page uses. It used to call the wallet layer's connect()
   * directly, which on a phone could only ever fail — there is nothing
   * injected to connect to — and the browser fallback that replaced it opened
   * the wallet with no approval step anywhere (the reported bug).
   */
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <div className="launch-wallet-cta-wrap">
      <SolanaConnectSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
      <button type="button" className="launch-wallet-cta" onClick={() => setSheetOpen(true)} disabled={wallet.busy}>
        <span className="launch-wallet-cta-ico" aria-hidden>
          {wallet.busy ? <span className="spinner spinner-sm" /> : <IconWallet width={20} height={20} />}
        </span>
        <span className="launch-wallet-cta-text">
          <span className="launch-wallet-cta-title">{t('launch.sol.connectTitle')}</span>
          <span className="launch-wallet-cta-sub">{t('launch.sol.connectSub')}</span>
        </span>
      </button>
      {wallet.error && (
        <p className="launch-hint">{t(`launch.sol.err.${wallet.error}`, { defaultValue: wallet.error })}</p>
      )}
      {wallet.error === 'NO_WALLET' && !inWalletBrowser && (
        <div className="launch-pct-row">
          {canInjectSolana()
            ? <span className="launch-hint">{t('launch.sol.noWalletDesktop')}</span>
            : (
              <a className="btn btn-ghost btn-sm" href={phantomBrowseLink(pageUrl) || '#'} target="_blank" rel="noreferrer">
                <IconExternal width={13} height={13} aria-hidden /> {t('launch.sol.openInPhantom')}
              </a>
            )}
        </div>
      )}
    </div>
  );
}

function SolResult({ run, plan, explorerFor, onRetryBuy, onRestart, onBack, t }) {
  const live = run.state === 'LIVE';
  const facts = run.facts;
  return (
    <div className={`launch-result ${live ? 'live' : 'partial'}`}>
      <div className={`launch-result-banner ${live ? 'ok' : 'warn'}`}>
        <span className="launch-result-ico" aria-hidden>
          {live ? <IconCoins width={26} height={26} /> : <IconShield width={26} height={26} />}
        </span>
        <div className="launch-result-banner-text">
          <h2>{live ? t('launch.result.live') : t(`launch.sol.state.${run.state}`, { defaultValue: run.state })}</h2>
          <p>
            {live
              ? t('launch.sol.liveBody')
              : run.error
                ? t(`launch.sol.err.${String(run.error).split(',')[0]}`, { defaultValue: run.error })
                : t('launch.result.failedBody')}
          </p>
        </div>
      </div>

      {facts?.token && (
        <div className="launch-result-card">
          <p className="launch-result-label">{t('launch.result.token')}</p>
          <p className="launch-result-name">{facts.token.name} ({facts.token.symbol})</p>
          <span className="launch-addr-row">
            <a className="mono launch-result-addr" href={explorerFor('address', facts.token.address)} target="_blank" rel="noreferrer">
              {facts.token.address} <IconExternal width={11} height={11} aria-hidden />
            </a>
            <CopyText text={facts.token.address} />
          </span>
          <p className="launch-hint">
            {t('launch.sol.mintState', {
              supply: baseToDecimalString(BigInt(facts.token.supply), 6),
              auth: facts.token.mintAuthorityState === 'revoked' ? t('launch.sol.revoked') : t('launch.sol.programHeld')
            })}
          </p>
        </div>
      )}
      {(facts?.pool || plan) && (
        <div className="launch-result-card">
          <p className="launch-result-label">{t('launch.result.pool')}</p>
          <span className="launch-addr-row">
            <a className="mono launch-result-addr" href={explorerFor('address', facts?.pool?.address || plan.addresses.poolId)} target="_blank" rel="noreferrer">
              {facts?.pool?.address || plan.addresses.poolId} <IconExternal width={11} height={11} aria-hidden />
            </a>
            <CopyText text={facts?.pool?.address || plan.addresses.poolId} />
          </span>
          {facts?.pool && (
            <p className="launch-hint">
              {t('launch.sol.poolState', {
                sold: baseToDecimalString(BigInt(facts.pool.realA), 6),
                raised: lamportsToSol(BigInt(facts.pool.realB)),
                status: facts.pool.status === 0 ? t('launch.sol.statusFund') : t('launch.sol.statusMigrate')
              })}
            </p>
          )}
        </div>
      )}
      {run.signatures?.create && (
        <div className="launch-result-card">
          <p className="launch-result-label">{t('launch.sol.createTx')}</p>
          <span className="launch-addr-row">
            <a className="mono launch-result-addr" href={explorerFor('tx', run.signatures.create)} target="_blank" rel="noreferrer">
              {shortAddress(run.signatures.create, 10)} <IconExternal width={11} height={11} aria-hidden />
            </a>
          </span>
        </div>
      )}

      <div className="btn-row">
        {run.state === 'BUY_FAILED' && plan?.buy && (
          <button type="button" className="btn btn-primary" onClick={onRetryBuy}>
            <IconRefresh width={14} height={14} aria-hidden /> {t('launch.sol.retryBuy')}
          </button>
        )}
        {!live && run.state !== 'BUY_FAILED' && (
          <button type="button" className="btn btn-ghost" onClick={onRestart}>
            {t('launch.sol.backToReview')}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          {t('launch.result.newLaunch')}
        </button>
      </div>
    </div>
  );
}
