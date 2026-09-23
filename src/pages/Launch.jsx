import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import Switch from '../components/Switch';
import WalletConnectSheet from '../components/WalletConnectSheet';
import SolanaLaunchFlow from '../components/SolanaLaunchFlow';
import {
  IconCheck,
  IconClock,
  IconCoins,
  IconCopy,
  IconExternal,
  IconInfo,
  IconLock,
  IconRefresh,
  IconRocket,
  IconShield,
  IconTrophy,
  IconWallet,
  IconX
} from '../components/Icons';
import { useWallet, shortAddress } from '../context/WalletContext';
import { EVM_CHAINS, explorerTx } from '../lib/chains';
import { chainSvg } from '../components/AssetIcon';
import {
  LAUNCH_CHAINS,
  LAUNCH_MODES,
  describeAllLaunchChains,
  quoteAssetsFor
} from '../lib/launch/networks';
import { solanaLaunchStatus } from '../lib/launch/solana/status';
import { CAPABILITIES, capsToBitmap, validateTokenSpec } from '../lib/launch/capabilities';
import { scoreLaunch, bandFor } from '../lib/launch/risk';
import { computeLaunchFee, LAUNCH_FEES } from '../lib/launch/fees';
import {
  buildLaunchPlan,
  buildDirectTokenCreateTx,
  buildLiquiditySteps,
  verifyDex,
  getExistingPair,
  parseTokenCreatedLog,
  FACTORY_ABI
} from '../lib/launch/calldata';
import * as engine from '../lib/launch/engine';
import { verifyLaunch, verifyDirectToken } from '../lib/launch/verify';
import { listHistory, recordLaunch, clearHistory } from '../lib/launch/history';
import { fetchLaunchConfig, postLaunchRecord } from '../lib/launch/api';
import { importTokenByAddress } from '../lib/tokenLists';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAppStore } from '../store/useAppStore';
import '../styles/launch.css';

const STEPS = ['network', 'token', 'rules', 'liquidity', 'review'];

/*
 * The Solana slot is driven by the status module, not by a hardcoded string:
 * `shipping` is false while ANY part of that workstream (wallet signing, the
 * Raydium pool flow, live-cluster verification) is unfinished, and the card
 * below is the COMING_SOON surface in that case. When all parts land the flag
 * flips by itself and this card becomes the entry point — the badge can never
 * say "coming soon" over a flow that is already signing, or the reverse.
 */
const SOLANA = solanaLaunchStatus();

const stepLabel = (id) => {
  const map = {
    'create-token': 'launch.run.createToken',
    'approve-token': 'launch.run.approveToken',
    'approve-quote': 'launch.run.approveQuote',
    'create-pair': 'launch.run.createPair',
    'add-liquidity': 'launch.run.addLiquidity',
    'deferred-pool': 'launch.run.poolPhase'
  };
  return map[id] || id;
};

/* Keep only digits and a SINGLE dot — "12.5.3" used to pass the sanitiser and
   then silently fail validation, leaving the user wondering why Next stayed
   disabled. */
const numOnly = (s) => {
  const c = String(s ?? '').replace(/[^0-9.]/g, '');
  const i = c.indexOf('.');
  if (i === -1) return c.replace(/^0+(?=\d)/, '');
  return (c.slice(0, i + 1) + c.slice(i + 1).replace(/\./g, '')).replace(/^0+(?=\d)/, '');
};

/*
 * Compact a computed decimal: N significant digits, no trailing zeros, and
 * NEVER scientific notation. "1e-9" would fail the digits-and-dot validation
 * and strand the user — and memecoin prices (tiny) and supplies (huge) hit
 * scientific notation constantly, so expanding here is load-bearing.
 */
const compactNum = (n, precision = 12) => {
  if (!Number.isFinite(n)) return '';
  let s = String(Number(n.toPrecision(precision)));
  if (/[eE]/.test(s)) {
    const neg = s.startsWith('-');
    const [m, e] = (neg ? s.slice(1) : s).split(/[eE]/);
    const exp = parseInt(e, 10);
    const [ip, fp = ''] = m.split('.');
    const digits = (ip + fp).replace(/^0+(?=\d)/, '') || '0';
    const point = ip.replace(/^0+(?=\d)/, '').length + exp;
    if (point <= 0) s = `0.${'0'.repeat(-point)}${digits}`;
    else if (point >= digits.length) s = digits + '0'.repeat(point - digits.length);
    else s = `${digits.slice(0, point)}.${digits.slice(point)}`;
    if (neg) s = `-${s}`;
  }
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
};

/*
 * THE API'S CHAIN REGISTRY, TRUSTED ONLY IN THE SHAPE WE ASKED FOR.
 *
 * `fetchLaunchConfig` REPLACES the built-in chain defaults with whatever the
 * endpoint returned, and the screen then reads the rows unguarded in render
 * (`chainMeta.find((c) => c.chainId === …)`, `c.dex.name` in the chain grid).
 * A payload that is not the descriptor list — a gateway error page that still
 * parses as JSON, a half-finished deploy, `{"networks":"maintenance"}` — was
 * spread straight into state and threw during render, landing on the crash
 * card exactly like the temporal-dead-zone bug inside the component below.
 *
 * The module is offline-first by design (see lib/launch/api), so the correct
 * degradation already exists: keep LOCAL truth and ignore the payload. Rows
 * that do not describe a chain with a DEX are dropped rather than repaired;
 * a registry with nothing usable in it is `null`, not an empty list.
 */
const apiNetworkRows = (cfg) => {
  if (!cfg || typeof cfg !== 'object' || !Array.isArray(cfg.networks)) return null;
  const rows = cfg.networks.filter((c) => (
    c && typeof c === 'object'
    && Number.isFinite(Number(c.chainId))
    && c.dex && typeof c.dex === 'object'
  ));
  return rows.length ? rows : null;
};

export default function Launch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const notify = useAppStore((s) => s.notify);
  // Live wallet ref: async loops (chain-switch waits) must read the CURRENT
  // context, not the closure copy captured when the callback was created.
  const walletRef = useRef(wallet);
  useEffect(() => { walletRef.current = wallet; }, [wallet]);

  const [step, setStep] = useState(0);
  const [solanaMode, setSolanaMode] = useState(false);
  const [view, setView] = useState('wizard'); // wizard | running | result
  const [launch, setLaunch] = useState(null);
  const [history, setHistory] = useState(() => listHistory());

  // ── form state ────────────────────────────────────────────────────────
  const [chainId, setChainId] = useState(LAUNCH_CHAINS[0]);
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [decimals, setDecimals] = useState(18);
  const [supply, setSupply] = useState('');
  const [logo, setLogo] = useState(null); // data URL, local only
  const [description, setDescription] = useState('');
  const [caps, setCaps] = useState({ mintable: false, burnable: false, pausable: false, maxWallet: false, maxTx: false });
  const [quoteSym, setQuoteSym] = useState('');
  const [tokenAmount, setTokenAmount] = useState('');
  const [quoteAmount, setQuoteAmount] = useState('');
  const [priceMode, setPriceMode] = useState('amounts'); // amounts | price
  const [initialPrice, setInitialPrice] = useState('');
  const [slippage, setSlippage] = useState(() => useSettingsStore.getState().defaultSlippage ?? 1);

  // ── network readiness (factory registry + DEX anchor verification) ───
  const [chainMeta, setChainMeta] = useState(() => describeAllLaunchChains());
  const [dexCheck, setDexCheck] = useState({}); // chainId -> {ok, checking, reason}
  const [configSource, setConfigSource] = useState('local');
  const [dexNonce, setDexNonce] = useState(0); // bump to re-verify on demand
  const [connectOpen, setConnectOpen] = useState(false); // in-place wallet popup

  useEffect(() => {
    let alive = true;
    fetchLaunchConfig().then((r) => {
      if (!alive || !r.ok || !r.json) return;
      const rows = apiNetworkRows(r.json);
      if (rows) {
        setChainMeta(rows);
        setConfigSource('api');
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // DEX anchor verification for the selected chain — the runtime proof that
  // the DEX factory constant is the real one (see networks.js header).
  // Re-runs on chain select, on wallet change, and on manual retry (a flaky
  // public RPC must never look like a permanently broken chain).
  useEffect(() => {
    let alive = true;
    setDexCheck((m) => ({ ...m, [chainId]: { ok: null, checking: true } }));
    (async () => {
      try {
        const provider = await wallet.getReadProvider(chainId);
        const res = await verifyDex(provider, chainId);
        if (alive) setDexCheck((m) => ({ ...m, [chainId]: { ok: res.ok, checking: false, reason: res.reason || null } }));
      } catch (e) {
        if (alive) setDexCheck((m) => ({ ...m, [chainId]: { ok: false, checking: false, reason: String(e?.message || 'RPC_UNREACHABLE') } }));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, wallet.address, wallet.chainId, dexNonce]);

  const chain = EVM_CHAINS[chainId];
  const meta = chainMeta.find((c) => c.chainId === chainId) || null;
  const dex = meta?.dex || null;
  const factoryAddress = meta?.fbtFactory || null;
  const dexOk = dexCheck[chainId]?.ok === true;
  const dexChecking = dexCheck[chainId]?.checking === true;
  /*
   * DEPLOY MODE — decided per chain, disclosed before any signature.
   *   · 'direct'  (default, v1): the token's creation bytecode is sent from the
   *     user's own wallet as a plain CREATE. No FBT contract exists in the
   *     transaction, so there is nothing to deploy and nothing to pay us.
   *   · 'factory': only when the deployment pins FBTTokenFactory for this
   *     chain (FBTLAUNCH_FACTORY_<chainId>) — the path a future on-chain fee
   *     would need. Compatible, opt-in, never a requirement.
   */
  const deployMode = meta?.mode || (factoryAddress ? LAUNCH_MODES.FACTORY : LAUNCH_MODES.DIRECT);
  const directDeploy = deployMode === LAUNCH_MODES.DIRECT;

  const quotes = useMemo(() => quoteAssetsFor(chainId), [chainId]);
  const quote = useMemo(() => {
    const found = quotes.find((q) => q.symbol === quoteSym);
    if (!found) return null;
    return {
      symbol: found.symbol,
      name: found.name,
      address: found.native ? null : found.address,
      decimals: found.decimals,
      native: Boolean(found.native)
    };
  }, [quotes, quoteSym]);

  useEffect(() => {
    if (!quotes.some((q) => q.symbol === quoteSym)) setQuoteSym(quotes[0]?.symbol || '');
  }, [chainId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── derived validation ────────────────────────────────────────────────
  const specResult = useMemo(
    () => validateTokenSpec({ name, symbol, decimals, supply, caps }),
    [name, symbol, decimals, supply, caps]
  );
  const spec = specResult.ok ? specResult.value : null;

  const amountValid = useMemo(() => {
    const okAmt = (s) => /^\d+(\.\d+)?$/.test(String(s).trim()) && Number(s) > 0;
    return okAmt(tokenAmount) && okAmt(quoteAmount);
  }, [tokenAmount, quoteAmount]);

  const impliedPrice = amountValid ? Number(quoteAmount) / Number(tokenAmount) : null;

  /*
   * PRICE MODE (fixed 2026-09-14): the price field used to be `disabled`
   * until `priceMode` became 'price' — but the ONLY code that set 'price'
   * was the disabled field's own onChange, which a disabled input never
   * fires. The field was unreachable: "Initial price کار نمیده". Now a
   * segmented control switches modes explicitly, and each mode derives the
   * other field instead of fighting over state.
   */
  useEffect(() => {
    if (priceMode !== 'price') return;
    const p = Number(initialPrice);
    const ta = Number(tokenAmount);
    if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(ta) || ta <= 0) {
      setQuoteAmount('');
      return;
    }
    setQuoteAmount(compactNum(p * ta));
  }, [initialPrice, tokenAmount, priceMode]);

  // Switching modes never strands the user on an empty field: entering price
  // mode seeds the price from the amounts already typed (when valid).
  const setPriceModeExplicit = useCallback((m) => {
    if (m === 'price' && m !== priceMode && impliedPrice != null) {
      setInitialPrice(compactNum(impliedPrice));
    }
    setPriceMode(m);
  }, [priceMode, impliedPrice]);

  // What the (read-only) side of each mode displays.
  const priceShown = priceMode === 'price'
    ? initialPrice
    : (impliedPrice != null ? compactNum(impliedPrice) : '');

  // % of total supply shortcuts for the token amount (only when the supply
  // typed on the token step is a real positive number).
  const supplyNum = Number(supply);
  const supplyValid = Number.isFinite(supplyNum) && supplyNum > 0;
  const setTokenPct = useCallback((pct) => {
    if (!Number.isFinite(supplyNum) || supplyNum <= 0) return;
    setTokenAmount(compactNum((supplyNum * pct) / 100));
  }, [supplyNum]);

  /*
   * BALANCE — the quote + gas read for the liquidity and review screens.
   *
   * DECLARED HERE, ABOVE `setQuoteMax`, AND THAT IS LOAD-BEARING. The state
   * used to live further down with the other review-step state, while the MAX
   * callback that reads it sits up here. A dependency ARRAY is evaluated
   * DURING the render, in source order, so `[balanceInfo, quote, …]` was read
   * before `const [balanceInfo] = useState(null)` had run — the whole page
   * threw `ReferenceError: Cannot access 'balanceInfo' before initialization`
   * on EVERY render, and the route fell through to the crash card:
   * «صفحه لانچ میگه با مشکل برخورد و نمیاره». A `const` in the same function
   * scope is in the temporal dead zone until its own line executes, so state
   * read by an earlier callback must be declared before it. Moving this line
   * back down re-breaks the page — `test/launch-crash-hunt-probe.jsx` mounts
   * the real screen and fails if it does.
   */
  const [balanceInfo, setBalanceInfo] = useState(null);

  // MAX for the quote side: ERC-20 quotes only. A native quote must NEVER be
  // maxed out — the wallet would be left with no gas for the signatures that
  // come after, stranding the launch mid-flow.
  const setQuoteMax = useCallback(() => {
    if (!balanceInfo?.human || quote?.native) return;
    setPriceModeExplicit('amounts');
    setQuoteAmount(balanceInfo.human);
  }, [balanceInfo, quote, setPriceModeExplicit]);

  // ── risk (live, deterministic, no network) ────────────────────────────
  const risk = useMemo(() => {
    if (!spec) return null;
    return scoreLaunch({
      capabilities: spec.capabilities,
      decimals: spec.decimals,
      supplyWei: spec.supplyWei,
      tokenAmount: amountValid ? tokenAmount : '0',
      quoteAmount: amountValid ? quoteAmount : '0',
      quoteDecimals: quote?.decimals || 0,
      dexVerified: dexOk === true,
      /*
       * The token step is never blocked by a missing FBT factory any more: in
       * direct mode (the default) the token bytes are sent as a plain CREATE
       * by the user's own wallet, so there is no operator contract to be
       * missing. The risk engine's factory gate is left untouched for
       * deployments that pin themselves to factory-only mode.
       */
      factoryReady: true,
      lpqToUser: true
    });
  }, [spec, amountValid, tokenAmount, quoteAmount, quote, dexOk]);

  const launchFee = computeLaunchFee(amountValid ? quoteAmount : '0', LAUNCH_FEES.launchFeeBps);
  // Maximum signatures for a full launch (the pair step is skipped at
  // runtime when the pair already exists — the review shows the worst case).
  const sigCount = useMemo(() => {
    let n = 1; // create-token
    n += 1; // approve token → router
    n += quote && !quote.native ? 1 : 0; // approve quote → router
    n += 1; // create-pair (if needed)
    n += 1; // add-liquidity
    return n;
  }, [quote]);

  // ── step gating ───────────────────────────────────────────────────────
  const canNext = useMemo(() => {
    switch (step) {
      case 0: return dexOk; // the DEX anchor + router proof, checked on-chain
      case 1: return specResult.ok;
      case 2: return true;
      case 3: return Boolean(quote) && amountValid && !risk?.blocked;
      default: return false;
    }
  }, [step, dexOk, specResult.ok, quote, amountValid, risk]);

  // ─────────────────────────── execution ───────────────────────────────
  const runRef = useRef(false);

  const saveHistory = useCallback((l, extra = {}) => {
    if (!l.config) return;
    const c = l.config;
    const hashes = l.steps.filter((s) => s.txHash).map((s) => s.txHash);
    recordLaunch({
      launchId: l.id,
      creatorPublicAddress: wallet.address || c.creator || null,
      network: c.chainId,
      networkName: EVM_CHAINS[c.chainId]?.name || String(c.chainId),
      tokenAddress: l.token?.address || null,
      poolAddress: l.pool?.address || null,
      tokenName: c.spec?.name || null,
      symbol: c.spec?.symbol || null,
      supply: c.spec?.supplyHuman || null,
      initialPrice: l.pool?.price || (c.quoteAmount && c.tokenAmount ? Number(c.quoteAmount) / Number(c.tokenAmount) : null),
      tokenLiquidity: c.tokenAmount || null,
      quoteLiquidity: c.quoteAmount || null,
      quoteSymbol: c.quote?.symbol || null,
      provider: c.dex?.id || null,
      status: l.state,
      riskScore: l.risk?.score ?? null,
      txHashes: hashes,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      ...extra
    });
    // Optional public record — refused (503) when the deployment has no
    // durable store; local history above is the source of truth either way.
    postLaunchRecord({
      launchId: l.id,
      creatorPublicAddress: wallet.address || c.creator || null,
      network: c.chainId,
      tokenAddress: l.token?.address || null,
      poolAddress: l.pool?.address || null,
      tokenName: c.spec?.name || null,
      symbol: c.spec?.symbol || null,
      status: l.state,
      riskScore: l.risk?.score ?? null,
      txHashes: hashes,
      createdAt: l.createdAt
    }).catch(() => {});
  }, [wallet.address]);

  /**
   * Drive one prepared step through the user's wallet.
   * The ONLY signing path in the module: wallet.getSigner() → sendTransaction.
   */
  const runStep = useCallback(async (l, st) => {
    const signer = wallet.getSigner();
    if (!signer) throw new Error('NO_SIGNER');
    engine.signingStarted(l, st.id);
    setLaunch({ ...l });

    const tx = { to: st.to, data: st.data };
    if (st.value && st.value !== '0') tx.value = st.value;
    if (st.gasLimit) tx.gasLimit = st.gasLimit;

    let sent;
    try {
      sent = await signer.sendTransaction(tx);
    } catch (e) {
      const msg = String(e?.shortMessage || e?.message || e?.code || 'SIGN_FAILED');
      const rejected = e?.code === 4001 || /user rejected|USER_REJECTED|request rejected/i.test(msg);
      if (rejected) engine.stepRejected(l, st.id);
      else engine.stepFailed(l, st.id, msg.slice(0, 160));
      setLaunch({ ...l });
      return;
    }

    engine.stepSubmitted(l, st.id, sent.hash);
    setLaunch({ ...l });
    engine.stepConfirming(l, st.id);

    let receipt;
    try {
      receipt = await sent.wait(1);
    } catch (e) {
      engine.stepFailed(l, st.id, String(e?.message || 'WAIT_FAILED').slice(0, 160));
      setLaunch({ ...l });
      return;
    }
    if (!receipt || receipt.status === 0) {
      engine.stepFailed(l, st.id, 'TX_REVERTED');
      setLaunch({ ...l });
      return;
    }

    // Event reads: the chain's own word on what actually happened.
    const provider = await wallet.getReadProvider(l.config.chainId);
    let tokenFacts = null;
    let poolFacts = null;
    if (st.id === 'create-token' && st.deploy) {
      /*
       * DIRECT DEPLOY — there is no factory event to parse. The chain's word
       * is three facts: the transaction succeeded, it was a deployment that
       * landed at the address PREDICTED BEFORE THE SIGNATURE, and the code
       * there equals the token bytecode we published, byte for byte. Any
       * failure stops the launch with a named reason instead of pairing
       * liquidity into a contract we cannot vouch for.
       */
      const vres = await verifyDirectToken(provider, receipt, {
        predictedAddress: st.predictedAddress,
        expectedCode: st.expectedCode
      });
      if (!vres.ok) {
        engine.stepFailed(l, st.id, vres.problems.join(',') || 'DIRECT_DEPLOY_UNVERIFIED');
        setLaunch({ ...l });
        return;
      }
      const s = l.config.spec;
      tokenFacts = {
        address: vres.address,
        name: s.name,
        symbol: s.symbol,
        decimals: s.decimals,
        supply: s.supplyWei,
        capabilities: Number(s.capabilities || 0),
        txHash: receipt.transactionHash,
        mode: LAUNCH_MODES.DIRECT,
        codeVerified: true
      };
    }
    if (st.id === 'create-token' && !st.deploy) {
      for (const log of receipt.logs || []) {
        if (log.address?.toLowerCase() !== l.config.factoryAddress.toLowerCase()) continue;
        const parsed = await parseTokenCreatedLog(log).catch(() => null);
        if (parsed) {
          // Normalise to the engine's token shape (it reads .address).
          tokenFacts = {
            address: parsed.token,
            name: parsed.name,
            symbol: parsed.symbol,
            decimals: parsed.decimals,
            supply: parsed.supply,
            capabilities: parsed.capabilities,
            txHash: receipt.transactionHash
          };
          break;
        }
      }
      if (!tokenFacts) {
        engine.stepFailed(l, st.id, 'TOKEN_EVENT_NOT_FOUND');
        setLaunch({ ...l });
        return;
      }
    }
    if (st.id === 'create-pair') {
      // Native quotes are paired against the wrapped native.
      const quoteAddr = l.config.quote.native ? l.config.dex.wrapped : l.config.quote.address;
      const pair = await getExistingPair(provider, l.config.chainId, l.token.address, quoteAddr);
      if (pair) poolFacts = { address: pair };
    }
    engine.stepConfirmed(l, st.id, {
      receipt: { transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed?.toString() },
      tokenFacts,
      poolFacts
    });
    setLaunch({ ...l });
  }, [wallet]);

  /**
   * The full launch loop. Phase one (token) is prepared before entry;
   * phase two (pool) is prepared with the REAL token address right after the
   * token mines — the deferred step from the plan becomes concrete bytes.
   */
  const startLaunch = useCallback(async (l) => {
    if (runRef.current) return;
    runRef.current = true;
    setLaunch({ ...l });
    setView('running');
    try {
      let cur = l;
      // Make sure the wallet is on the launch network before any signature.
      if (walletRef.current.chainId !== cur.config.chainId) {
        const switched = await wallet.switchChain?.(cur.config.chainId);
        if (!switched) { engine.stepFailed(cur, cur.steps[0].id, 'CHAIN_SWITCH_REJECTED'); setLaunch({ ...cur }); return; }
        // wait for the context to land on the new chain (live ref, not closure)
        let waited = 0;
        while (walletRef.current.chainId !== cur.config.chainId && waited < 30_000) {
          await new Promise((r) => setTimeout(r, 250));
          waited += 250;
        }
        if (walletRef.current.chainId !== cur.config.chainId) {
          engine.stepFailed(cur, cur.steps[0].id, 'CHAIN_SWITCH_TIMEOUT');
          setLaunch({ ...cur });
          return;
        }
      }

      const provider = await wallet.getReadProvider(cur.config.chainId);

      // Phase one — everything prepared up to (not including) the pool
      const queue = [];
      for (const st of cur.steps) {
        if (st.deferred) break;
        queue.push(st);
      }

      /*
       * DIRECT DEPLOY: freeze the address right before the signature. The
       * nonce that produces the CREATE address is read live (pending), the
       * bytes are rebuilt for it, and that frozen address is what the
       * confirmation step later verifies the chain against. If the nonce had
       * moved since the review screen, the user is looking at the new,
       * authoritative address in this panel — never at a stale one.
       */
      if (directDeploy && queue[0]?.deploy) {
        try {
          const liveNonce = await provider.getTransactionCount(wallet.address, 'pending');
          const fresh = await buildDirectTokenCreateTx({ spec: cur.config.spec, creator: cur.config.creator, nonce: liveNonce });
          const keep = { status: queue[0].status, gasLimit: queue[0].gasLimit };
          Object.assign(queue[0], fresh, keep);
          cur.config.predictedTokenAddress = fresh.predictedAddress;
          cur.config.nonce = fresh.nonce;
          setLaunch({ ...cur });
        } catch (e) {
          engine.stepFailed(cur, queue[0].id, `ADDRESS_PREDICTION_FAILED: ${String(e?.message || 'NONCE_UNREADABLE').slice(0, 120)}`);
          setLaunch({ ...cur });
          return;
        }
      }

      // simulate the remaining phase-one steps right now (gas prices move)
      engine.simulateStart(cur);
      const gas = {};
      for (const st of queue) {
        try {
          const g = await provider.estimateGas({ from: wallet.address, to: st.to, data: st.data, value: st.value && st.value !== '0' ? st.value : undefined });
          gas[st.id] = g.toString();
          st.gasLimit = (g * 12n) / 10n; // 20% headroom
        } catch (e) {
          engine.stepFailed(cur, st.id, `SIMULATION_FAILED: ${String(e?.shortMessage || e?.message || 'REVERT').slice(0, 120)}`);
          setLaunch({ ...cur });
          return;
        }
      }
      engine.simulateDone(cur, { gas });
      engine.confirmIntent(cur);
      setLaunch({ ...cur });

      while (true) {
        const next = engine.nextPendingStep(cur);
        if (!next) break;
        // The pool phase materialises here: real token address, live pair
        // re-check, fresh bytes for the steps after it.
        if (next.needsReprepare) {
          const livePair = await getExistingPair(provider, cur.config.chainId, cur.token.address,
            cur.config.quote.native ? cur.config.dex.wrapped : cur.config.quote.address);
          const liq = await buildLiquiditySteps({
            chainId: cur.config.chainId,
            token: cur.token.address,
            quote: cur.config.quote,
            tokenAmount: cur.config.tokenAmount,
            quoteAmount: cur.config.quoteAmount,
            slippageBps: cur.config.slippageBps,
            creator: cur.config.creator,
            createPairNeeded: !livePair,
            pairAddress: livePair
          });
          // splice the deferred placeholder for the real steps
          const idx = cur.steps.findIndex((s) => s.id === next.id);
          cur.steps.splice(idx, 1, ...liq.steps.map((s) => ({ ...s, status: 'ready', gasLimit: null })));
          cur.config.createPairNeeded = !livePair;
          cur.config.pairAddress = livePair;
          setLaunch({ ...cur });
          // estimate the fresh pool steps
          for (const st of cur.steps.slice(idx)) {
            try {
              const g = await provider.estimateGas({ from: wallet.address, to: st.to, data: st.data, value: st.value && st.value !== '0' ? st.value : undefined });
              st.gasLimit = (g * 12n) / 10n;
            } catch (e) {
              engine.stepFailed(cur, st.id, `SIMULATION_FAILED: ${String(e?.shortMessage || e?.message || 'REVERT').slice(0, 120)}`);
              setLaunch({ ...cur });
              return;
            }
          }
          continue;
        }
        /*
         * A missing signer (wallet disconnected mid-flow) must become a NAMED
         * failure on the step — never an uncaught throw that freezes the run
         * view with no explanation. The wallet gate in onLaunch makes this
         * nearly unreachable; this is the belt to its suspenders.
         */
        try {
          await runStep(cur, next);
        } catch (e) {
          engine.stepFailed(cur, next.id, 'SIGNER_UNAVAILABLE');
          setLaunch({ ...cur });
          break;
        }
        if (!['AWAITING_CONFIRMATION', 'CONFIRMING'].includes(cur.state)) break; // failed/retryable/cancelled
      }

      if (cur.state === 'CONFIRMING' || cur.state === 'AWAITING_CONFIRMATION') {
        // All steps mined — verify against the chain before claiming LIVE.
        const tokenAddress = cur.token?.address;
        const pairAddress = cur.pool?.address || await getExistingPair(provider, cur.config.chainId, tokenAddress,
          cur.config.quote.native ? cur.config.dex.wrapped : cur.config.quote.address);
        const liqStep = cur.steps.find((s) => s.id === 'add-liquidity');
        const vres = await verifyLaunch(provider, {
          chainId: cur.config.chainId,
          tokenAddress,
          pairAddress,
          creator: cur.config.creator,
          quote: cur.config.quote,
          tokenMin: liqStep?.tokenMin || null,
          quoteMin: liqStep?.quoteMin || null,
          newPair: cur.config.createPairNeeded !== false,
          desired: { token: liqStep?.tokenAmountWei, quote: liqStep?.quoteAmountWei },
          expect: {
            expectName: cur.config.spec.name,
            expectSymbol: cur.config.spec.symbol,
            expectDecimals: cur.config.spec.decimals,
            expectSupply: cur.config.spec.supplyWei
          }
        }).catch(() => null);

        if (vres?.ok) {
          engine.verified(cur, {
            token: { address: vres.token.address, name: vres.token.name, symbol: vres.token.symbol },
            pool: {
              address: pairAddress,
              lpBalance: vres.pool.lpBalance,
              reserves: vres.pool.reserves,
              price: cur.config.quoteAmount && cur.config.tokenAmount
                ? Number(cur.config.quoteAmount) / Number(cur.config.tokenAmount)
                : null
            }
          });
          engine.live(cur);
        } else {
          const problems = [...(vres?.token?.problems || []), ...(vres?.pool?.problems || [])];
          engine.stepFailed(cur, cur.steps[cur.steps.length - 1].id, `VERIFY_FAILED: ${problems.join(',') || 'UNKNOWN'}`);
        }
      }
      saveHistory(cur);
      setHistory(listHistory());
      setView('result');
    } finally {
      runRef.current = false;
    }
  }, [wallet, saveHistory, runStep]);

  // ── review: build the phase-one plan ─────────────────────────────────
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const doPlan = useCallback(async () => {
    if (!spec || !quote || !amountValid) return;
    setPlanning(true);
    try {
      // Direct mode shows the user the address their token WILL be deployed
      // at before they sign, so the plan needs the account nonce. It is
      // re-read right before signing (startLaunch) — a nonce that moved in
      // between must never make the printed address a lie.
      let nonce = 0;
      if (directDeploy && wallet.address) {
        try {
          const provider = await wallet.getReadProvider(chainId);
          nonce = await provider.getTransactionCount(wallet.address, 'pending');
        } catch {
          nonce = 0;
        }
      }
      const p = await buildLaunchPlan({
        chainId,
        factoryAddress,
        mode: deployMode,
        nonce,
        spec,
        quote,
        tokenAmount,
        quoteAmount,
        slippageBps: Math.round(slippage * 100),
        creator: wallet.address
      });
      setPlan(p);
    } catch (e) {
      notify?.('launchError', 'error');
    } finally {
      setPlanning(false);
    }
  }, [spec, quote, amountValid, chainId, factoryAddress, deployMode, directDeploy, tokenAmount, quoteAmount, slippage, wallet.address, notify]);

  /*
   * A plan is a snapshot of THESE inputs. Going back to edit amounts (or the
   * token, quote, slippage…) and returning must rebuild it — reviewing stale
   * numbers while signing fresh ones is exactly how money gets wasted.
   */
  const planKey = JSON.stringify([chainId, name, symbol, decimals, supply, caps, quoteSym, tokenAmount, quoteAmount, slippage, wallet.address]);
  useEffect(() => { setPlan(null); }, [planKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (step === 4 && !plan && !planning) doPlan();
  }, [step, plan, planning, doPlan]);

  /*
   * Quote + gas balance check for the liquidity AND review screens (honest,
   * read-only, debounced so typing doesn't spam the RPC).
   *
   * PRECISION (fixed 2026-09-14): the old check computed
   * `BigInt(Math.ceil(Number(amount) * 10 ** decimals))` — for an 18-decimal
   * quote, `10 ** 18` already exceeds float precision, so the comparison
   * could BOTH wrongly block a funded launch and wrongly pass an unfunded
   * one. parseUnits does the decimal math exactly; a parse failure means the
   * amount is not even representable, which is itself a block.
   */
  useEffect(() => {
    if ((step !== 3 && step !== 4) || !quote || !wallet.address) { setBalanceInfo(null); return; }
    let alive = true;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const provider = await wallet.getReadProvider(chainId);
          const { Contract, parseUnits, formatUnits } = await import('ethers');
          let bal;
          if (quote.native) bal = await provider.getBalance(wallet.address);
          else {
            const c = new Contract(quote.address, ['function balanceOf(address) view returns (uint256)'], provider);
            bal = await c.balanceOf(wallet.address);
          }
          const gasWei = quote.native ? bal : await provider.getBalance(wallet.address);
          let enough = null;
          if (amountValid) {
            try {
              enough = BigInt(bal.toString()) >= parseUnits(quoteAmount, quote.decimals);
            } catch { enough = false; }
          }
          if (alive) {
            setBalanceInfo({
              wei: bal.toString(),
              human: compactNum(Number(formatUnits(bal, quote.decimals))),
              decimals: quote.decimals,
              enough,
              gasWei: gasWei.toString(),
              gasOk: BigInt(gasWei.toString()) > 0n
            });
          }
        } catch {
          if (alive) setBalanceInfo(null);
        }
      })();
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, quote, amountValid, wallet.address, quoteAmount, chainId]);

  const walletReady = Boolean(wallet.address);
  /*
   * KNOWN-insufficient balance (quote or gas) blocks the button: launching
   * anyway would burn gas on a reverting addLiquidity. UNKNOWN balance
   * (still loading / RPC hiccup) does NOT block — the pre-signature
   * simulation in startLaunch re-checks everything and fails NAMED before
   * any signature, so an unfunded launch can never cost more than zero.
   */
  const fundsOk = balanceInfo?.enough !== false && balanceInfo?.gasOk !== false;
  const launchReady = canNext && step === 4 && risk && !risk.blocked && walletReady && fundsOk && (
    !risk.confirmRequired || confirmText.trim().toUpperCase() === symbol.trim().toUpperCase()
  ) && !planning && Boolean(plan);

  const onLaunch = () => {
    // No wallet, no run: open the connect sheet IN PLACE (never navigate
    // away to the wallet screen — the wizard state must survive connecting).
    if (!wallet.address) { setConnectOpen(true); return; }
    if (!launchReady) return;
    const l = engine.createLaunch();
    const cfg = {
      chainId,
      dex,
      mode: deployMode,
      factoryAddress,
      predictedTokenAddress: plan?.predictedTokenAddress || null,
      spec,
      quote,
      tokenAmount,
      quoteAmount,
      slippageBps: Math.round(slippage * 100),
      creator: wallet.address,
      createPairNeeded: plan?.createPairNeeded ?? null,
      pairAddress: plan?.pairAddress || null,
      steps: plan.steps,
      risk
    };
    engine.configure(l, cfg);
    setLaunch(l);
    startLaunch(l);
  };

  const onRetryPool = () => {
    if (!launch) return;
    engine.retryPool(launch);
    setLaunch({ ...launch });
    setView('running');
    // re-enter the loop with the token already on-chain
    const cur = { ...launch };
    startFromRetry(cur);
  };

  const startFromRetry = async (l) => {
    runRef.current = true;
    try {
      const provider = await wallet.getReadProvider(l.config.chainId);
      const tokenAddress = l.token.address;
      const livePair = await getExistingPair(provider, l.config.chainId, tokenAddress,
        l.config.quote.native ? l.config.dex.wrapped : l.config.quote.address);
      const liq = await buildLiquiditySteps({
        chainId: l.config.chainId,
        token: tokenAddress,
        quote: l.config.quote,
        tokenAmount: l.config.tokenAmount,
        quoteAmount: l.config.quoteAmount,
        slippageBps: l.config.slippageBps,
        creator: l.config.creator,
        createPairNeeded: !livePair,
        pairAddress: livePair
      });
      // keep the confirmed token step, replace the rest with fresh steps.
      // State is already CONFIGURED (engine.retryPool put it there), which is
      // exactly where simulateStart expects to find it.
      const tokenStep = l.steps.find((s) => s.id === 'create-token');
      l.steps = [tokenStep, ...liq.steps.map((s) => ({ ...s, status: 'ready' }))];
      l.config.createPairNeeded = !livePair;
      l.config.pairAddress = livePair;
      l.partial = null;
      setLaunch({ ...l });
      engine.simulateStart(l);
      const gas = {};
      for (const st of l.steps) {
        if (st.id === 'create-token') continue;
        try {
          const g = await provider.estimateGas({ from: wallet.address, to: st.to, data: st.data, value: st.value && st.value !== '0' ? st.value : undefined });
          gas[st.id] = g.toString();
          st.gasLimit = (g * 12n) / 10n;
        } catch (e) {
          engine.stepFailed(l, st.id, `SIMULATION_FAILED: ${String(e?.shortMessage || e?.message || 'REVERT').slice(0, 120)}`);
          setLaunch({ ...l });
          return;
        }
      }
      engine.simulateDone(l, { gas });
      engine.confirmIntent(l);
      setLaunch({ ...l });
      while (true) {
        const next = engine.nextPendingStep(l);
        if (!next) break;
        try {
          await runStep(l, next);
        } catch (e) {
          engine.stepFailed(l, next.id, 'SIGNER_UNAVAILABLE');
          setLaunch({ ...l });
          break;
        }
        if (!['AWAITING_CONFIRMATION', 'CONFIRMING'].includes(l.state)) break;
      }
      if (l.state === 'CONFIRMING' || l.state === 'AWAITING_CONFIRMATION') {
        const pairAddress = l.pool?.address || livePair;
        const liqStep = l.steps.find((s) => s.id === 'add-liquidity');
        const vres = await verifyLaunch(provider, {
          chainId: l.config.chainId,
          tokenAddress,
          pairAddress,
          creator: l.config.creator,
          quote: l.config.quote,
          tokenMin: liqStep?.tokenMin || null,
          quoteMin: liqStep?.quoteMin || null,
          newPair: l.config.createPairNeeded !== false,
          expect: { expectName: l.config.spec.name, expectSymbol: l.config.spec.symbol, expectDecimals: l.config.spec.decimals, expectSupply: l.config.spec.supplyWei }
        }).catch(() => null);
        if (vres?.ok) {
          engine.verified(l, {
            token: { address: vres.token.address },
            pool: { address: pairAddress, lpBalance: vres.pool.lpBalance, reserves: vres.pool.reserves, price: Number(l.config.quoteAmount) / Number(l.config.tokenAmount) }
          });
          engine.live(l);
        } else {
          const problems = [...(vres?.token?.problems || []), ...(vres?.pool?.problems || [])];
          engine.stepFailed(l, l.steps[l.steps.length - 1].id, `VERIFY_FAILED: ${problems.join(',') || 'UNKNOWN'}`);
        }
      }
      saveHistory(l);
      setHistory(listHistory());
      setView('result');
    } finally {
      runRef.current = false;
    }
  };

  const onAddToSwap = async () => {
    if (!launch?.token?.address) return;
    try {
      const provider = await wallet.getReadProvider(launch.config.chainId);
      await importTokenByAddress(provider, launch.config.chainId, launch.token.address);
      notify?.('launchAddedToSwap', 'success');
      navigate('/swap');
    } catch {
      notify?.('launchError', 'error');
    }
  };

  const onCancelRun = () => {
    if (!launch) return;
    engine.cancel(launch);
    saveHistory(launch);
    setLaunch({ ...launch });
    setView('result');
    setHistory(listHistory());
  };

  // ─────────────────────────── render ──────────────────────────────────
  return (
    <PageTransition>
      <div className="launch-page">
        {/* HERO — glass box: the icon floats, its flame pulses, the copy sits
            inside the same surface as the badges. Motion is decorative only
            and switches off entirely under prefers-reduced-motion (launch.css). */}
        <header className="launch-hero launch-hero-v2">
          <span className="launch-hero-aurora" aria-hidden />
          <span className="launch-hero-grid" aria-hidden />
          <span className="launch-hero-stars" aria-hidden />
          <div className="launch-hero-row">
            <div className="launch-title">
              <span className="launch-rocket" aria-hidden>
                <span className="launch-rocket-orbit" />
                <span className="launch-rocket-glow" />
                <IconRocket className="launch-rocket-icon" width={30} height={30} />
                <span className="launch-rocket-trail" />
              </span>
              <div className="launch-title-text">
                <span className="launch-eyebrow">
                  <span className="launch-eyebrow-dot" aria-hidden />
                  {t('launch.hero.eyebrow')}
                </span>
                <h1><span className="launch-h1-grad">{t('launch.title')}</span></h1>
                <p>{t('launch.subtitle')}</p>
              </div>
            </div>
            <div className="launch-badges">
              <span className="launch-badge nc">
                <span className="launch-badge-dot" aria-hidden />
                {t('launch.nonCustodial')}
              </span>
              <span className={`launch-badge mode ${directDeploy ? 'direct' : 'factory'}`}>
                {directDeploy ? t('launch.mode.direct') : t('launch.mode.factory')}
              </span>
            </div>
          </div>

          {/* The three beats of the sentence above, as a walkable strip —
              token → pool → live — with the networks this desk can launch
              on shown by their real logos. Decorative; the wizard's stepper
              below is the interactive one. */}
          <div className="launch-hero-foot">
            <ol className="launch-hero-flow" aria-label={t('launch.steps')}>
              <li className="launch-hero-beat">
                <span className="launch-hero-beat-ico"><IconCoins width={13} height={13} /></span>
                <span>{t('launch.hero.beat1')}</span>
              </li>
              <li className="launch-hero-arrow" aria-hidden>›</li>
              <li className="launch-hero-beat">
                <span className="launch-hero-beat-ico"><IconShield width={13} height={13} /></span>
                <span>{t('launch.hero.beat2')}</span>
              </li>
              <li className="launch-hero-arrow" aria-hidden>›</li>
              <li className="launch-hero-beat">
                <span className="launch-hero-beat-ico"><IconRocket width={13} height={13} /></span>
                <span>{t('launch.hero.beat3')}</span>
              </li>
            </ol>
            <div className="launch-hero-nets" aria-label={t('launch.network.title')}>
              {[...chainMeta.slice(0, 6).map((c) => ({ id: c.chainId, color: c.color, short: c.short })),
                ...(SOLANA.shipping ? [{ id: 'solana', color: '#14f195', short: 'SOL' }] : [])].map((c, i) => (
                <span key={String(c.id)} className="launch-hero-net" style={{ zIndex: 20 - i }}>
                  <ChainMark color={c.color} short={c.short} size={24} chain={c.id} />
                </span>
              ))}
            </div>
          </div>
        </header>

        {solanaMode ? (
          <SolanaLaunchFlow
            onBack={() => setSolanaMode(false)}
            onHistory={() => setHistory(listHistory())}
          />
        ) : (
        <AnimatePresence mode="wait">
          {view === 'wizard' && (
            <motion.div key="wizard" className="launch-flow" variants={riseIn} initial="hidden" animate="show" exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
              {/* .launch-flow: the wizard wrapper used to be a BARE motion.div,
                  so the stepper, the section and the buttons stacked with ZERO
                  gap. One flex column fixes the button/box spacing. */}
              {/* stepper */}
              <div className="launch-stepper" role="tablist" aria-label={t('launch.steps')}>
                {STEPS.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={step === i}
                    className={`launch-step${step === i ? ' active' : ''}${i < step ? ' done' : ''}`}
                    onClick={() => { if (i < step) setStep(i); }}
                    disabled={i > step}
                  >
                    <span className="launch-step-num">{i < step ? <IconCheck width={12} height={12} /> : i + 1}</span>
                    <span className="launch-step-label">{t(`launch.step.${s}`)}</span>
                  </button>
                ))}
              </div>

              {/* ── STEP 1 — NETWORK ── */}
              {step === 0 && (
                <section className="launch-section">
                  <h2 className="launch-h2">{t('launch.network.title')}</h2>
                  <div className="launch-chain-grid">
                    {chainMeta.map((c) => {
                      const check = dexCheck[c.chainId];
                      const selected = chainId === c.chainId;
                      const statusCls = check?.checking ? 'warn' : check?.ok === true ? 'ok' : check?.ok === false ? 'bad' : '';
                      return (
                        <button
                          key={c.chainId}
                          type="button"
                          className={`launch-chain${selected ? ' active' : ''}`}
                          onClick={() => setChainId(c.chainId)}
                          aria-pressed={selected}
                          style={{ '--chain-color': c.color }}
                        >
                          <span className="launch-chain-top">
                            <ChainMark color={c.color} short={c.short} size={38} chain={c.chainId} />
                            <span className="launch-chain-id">
                              <span className="launch-chain-name">{c.name}</span>
                              <span className="launch-chain-dex">{c.dex.name}</span>
                            </span>
                            {selected && (
                              <span className="launch-chain-tick" aria-hidden>
                                <IconCheck width={12} height={12} />
                              </span>
                            )}
                          </span>
                          <span className="launch-chain-pills">
                            <span className={`launch-chain-mode ${c.mode === 'factory' ? 'factory' : 'direct'}`}>
                              {c.mode === 'factory' ? t('launch.mode.factory') : t('launch.mode.direct')}
                            </span>
                            <span className={`launch-chain-status ${statusCls}`}>
                              <span className="launch-status-dot" aria-hidden />
                              {selected && check?.checking ? t('launch.network.verifyingShort')
                                : selected && check?.ok === true ? t('launch.network.ready')
                                  : selected && check?.ok === false ? t('launch.network.blocked')
                                    : t('launch.network.tapToVerify')}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                    {/* Solana slot — driven by lib/launch/solana/status.js. The
                        pending list is named (never a vague "in progress"), so
                        the badge and the reason under it cannot disagree. */}
                    {SOLANA.shipping ? (
                      <button
                        type="button"
                        className="launch-chain"
                        onClick={() => setSolanaMode(true)}
                        style={{ '--chain-color': '#14f195' }}
                      >
                        <span className="launch-chain-top">
                          <ChainMark color="#14f195" short="SOL" size={38} chain="solana" />
                          <span className="launch-chain-id">
                            <span className="launch-chain-name">Solana</span>
                            <span className="launch-chain-dex">{t('launch.sol.cardDex')}</span>
                          </span>
                          <span className="launch-chain-tick" aria-hidden>
                            <IconCheck width={12} height={12} />
                          </span>
                        </span>
                        <span className="launch-chain-pills">
                          <span className="launch-chain-mode">LaunchLab</span>
                          <span className="launch-chain-status ok">
                            <span className="launch-status-dot" aria-hidden />
                            {t('launch.network.ready')}
                          </span>
                        </span>
                      </button>
                    ) : (
                      <div
                        className="launch-chain soon"
                        aria-disabled="true"
                        title={SOLANA.statement}
                        data-solana-pending={SOLANA.pending.join(',')}
                      >
                        <span className="launch-chain-top">
                          <ChainMark color="#14f195" short="SOL" size={38} dim chain="solana" />
                          <span className="launch-chain-id">
                            <span className="launch-chain-name">Solana</span>
                            <span className="launch-chain-dex">SPL · {t('launch.network.solanaPending', { n: SOLANA.pending.length })}</span>
                          </span>
                          <span className="launch-chain-tick soon" aria-hidden>
                            <IconClock width={13} height={13} />
                          </span>
                        </span>
                        <span className="launch-chain-pills">
                          <span className="launch-chain-status warn">
                            <span className="launch-status-dot" aria-hidden />
                            {t('launch.network.soon')}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* DEX verification banner — the runtime proof, visible, with
                      a retry for flaky public RPCs. Shows the LAUNCH dex name
                      (meta.dex.name), never the swap router's (chain.dexName
                      is Velodrome on Optimism while the launch runs on
                      Uniswap V2 — the old fallback printed the wrong DEX). */}
                  {chain && (
                    <div className={`launch-dexcheck ${dexChecking ? 'checking' : dexOk ? 'ok' : 'bad'}`} role="status">
                      <span className="launch-dexcheck-ico" aria-hidden>
                        {dexChecking ? <span className="spinner spinner-sm" />
                          : dexOk ? <IconCheck width={15} height={15} />
                            : <IconShield width={15} height={15} />}
                      </span>
                      <span className="launch-dexcheck-text">
                        {dexChecking && t('launch.network.verifying')}
                        {!dexChecking && dexOk && t('launch.network.verified', { dex: dex?.name || chain.dexName })}
                        {!dexChecking && !dexOk && t('launch.network.verifyFailed', { reason: dexCheck[chainId]?.reason || '' })}
                      </span>
                      {!dexChecking && !dexOk && (
                        <button type="button" className="launch-dexcheck-retry" onClick={() => setDexNonce((n) => n + 1)}>
                          <IconRefresh width={13} height={13} aria-hidden />
                          {t('launch.network.retry')}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Which mode this chain launches in — said out loud, before
                      any signature, because the two paths differ in exactly
                      one way the user cares about: whether an FBT contract is
                      in their transaction at all. */}
                  <InfoBox tone="info" title={directDeploy ? t('launch.network.directTitle') : t('launch.network.factoryTitle')}>
                    {directDeploy ? t('launch.network.directBody') : t('launch.network.factoryModeBody')}
                  </InfoBox>
                </section>
              )}

              {/* ── STEP 2 — TOKEN ── */}
              {step === 1 && (
                <section className="launch-section">
                  <h2 className="launch-h2">{t('launch.token.title')}</h2>
                  <div className="launch-token-card">
                    <div className="launch-logo-row">
                      {/* No custom logo → the NETWORK's mark (modern gradient,
                          not a grey box): the token always has an identity. */}
                      {logo
                        ? <img className="launch-logo" src={logo} alt="" />
                        : <ChainMark color={meta?.color || '#00e5ff'} short={symbol?.slice(0, 3) || meta?.short || '?'} size={52} />}
                      <div className="launch-logo-cta">
                        <label className="btn btn-ghost btn-sm">
                          {t('launch.token.logo')}
                          <input type="file" accept="image/png,image/jpeg" hidden
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                  const rd = new FileReader();
                              rd.onload = () => setLogo(String(rd.result));
                              rd.readAsDataURL(f);
                              e.target.value = '';
                            }} />
                        </label>
                        {logo && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLogo(null)}>
                            <IconX width={13} height={13} aria-hidden />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="launch-hint">{t('launch.token.logoFallback')}</p>
                    <div className="launch-field">
                      <label className="field-label">{t('launch.token.name')}</label>
                      <input className="launch-input" value={name} maxLength={64} placeholder={t('launch.token.namePh')}
                        onChange={(e) => setName(e.target.value)} autoCapitalize="off" spellCheck={false} />
                    </div>
                    <div className="launch-field-row">
                      <div className="launch-field">
                        <label className="field-label">{t('launch.token.symbol')}</label>
                        <input className="launch-input" value={symbol} maxLength={16} placeholder={t('launch.token.symbolPh')}
                          onChange={(e) => setSymbol(e.target.value.toUpperCase())} autoCapitalize="characters" spellCheck={false} />
                      </div>
                      <div className="launch-field">
                        <label className="field-label">{t('launch.token.decimals')}</label>
                        <select className="launch-input" value={decimals} onChange={(e) => setDecimals(Number(e.target.value))}>
                          {[0, 6, 9, 18].map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="launch-field">
                      <label className="field-label">{t('launch.token.supply')}</label>
                      <input className="launch-input mono" inputMode="decimal" value={supply} placeholder={t('launch.token.supplyPh')}
                        onChange={(e) => setSupply(numOnly(e.target.value))} />
                      {specResult.ok && spec && (
                        <p className="launch-hint">{t('launch.token.supplyFull')}: {spec.supplyWei}</p>
                      )}
                    </div>
                    <div className="launch-field">
                      <label className="field-label">{t('launch.token.description')}</label>
                      <textarea className="launch-input launch-textarea" rows={2} maxLength={280} value={description}
                        onChange={(e) => setDescription(e.target.value)} />
                      <p className="launch-hint">{t('launch.token.localOnly')}</p>
                    </div>
                  </div>
                  {!specResult.ok && specResult.errors.length > 0 && (
                    <div className="launch-errors">
                      {specResult.errors.map((er) => <span key={er} className="launch-error-chip">{t(`launch.err.${er}`)}</span>)}
                    </div>
                  )}
                </section>
              )}

              {/* ── STEP 3 — RULES ── */}
              {step === 2 && (
                <section className="launch-section">
                  <h2 className="launch-h2">{t('launch.rules.title')}</h2>
                  <div className={`launch-mode-card ${!caps.mintable && !caps.burnable && !caps.pausable && !caps.maxWallet && !caps.maxTx ? 'active' : ''}`}>
                    <div className="launch-mode-head">
                      <span className="launch-mode-name">{t('launch.rules.basic')}</span>
                      <span className="launch-mode-tag">{t('launch.rules.recommended')}</span>
                    </div>
                    <p className="launch-mode-desc">{t('launch.rules.basicDesc')}</p>
                  </div>
                  <div className="launch-mode-card">
                    <div className="launch-mode-head">
                      <span className="launch-mode-name">{t('launch.rules.advanced')}</span>
                    </div>
                    <p className="launch-mode-desc">{t('launch.rules.advancedDesc')}</p>
                    {CAPABILITIES.map((cap) => {
                      const enabled = Boolean(caps[cap.id]);
                      return (
                        <div key={cap.id} className={`launch-cap-row${enabled ? ' on' : ''}`}>
                          <div className="launch-cap-text">
                            <p className="launch-cap-name">
                              {enabled && <span className="launch-cap-dot" aria-hidden />}
                              {t(cap.labelKey)}
                              <span className="launch-cap-risk">+{cap.risk}</span>
                            </p>
                            <p className="launch-cap-warn">{t(cap.warnKey)}</p>
                          </div>
                          {/* Explicit toggle (never stores the click event):
                              ON and OFF both work, in both directions. */}
                          <Switch
                            on={enabled}
                            label={t(cap.labelKey)}
                            onChange={() => setCaps((c) => ({ ...c, [cap.id]: !c[cap.id] }))}
                          />
                        </div>
                      );
                    })}
                  </div>
                  {risk && (
                    <RiskPill risk={risk} t={t} />
                  )}
                </section>
              )}

              {/* ── STEP 4 — LIQUIDITY ── */}
              {step === 3 && (
                <section className="launch-section">
                  <h2 className="launch-h2">{t('launch.liq.title')}</h2>
                  <div className="launch-field">
                    <label className="field-label">{t('launch.liq.quote')}</label>
                    <div className="launch-chip-row" role="radiogroup" aria-label={t('launch.liq.quote')}>
                      {quotes.map((q) => {
                        const active = quoteSym === q.symbol;
                        return (
                          <button key={q.symbol} type="button" role="radio" aria-checked={active}
                            className={`launch-chip${active ? ' active' : ''}`}
                            onClick={() => setQuoteSym(q.symbol)}>
                            {active && <IconCheck width={13} height={13} aria-hidden />}
                            <span>{q.symbol}</span>
                            {q.native && <span className="launch-chip-tag">{t('launch.liq.nativeTag')}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Pricing mode: type AMOUNTS and read the price, or type the
                      PRICE and read the quote amount. Explicit control — the
                      old UI had no way to reach price mode at all. */}
                  <div className="launch-seg" role="tablist" aria-label={t('launch.liq.price')}>
                    <button type="button" role="tab" aria-selected={priceMode === 'amounts'}
                      className={`launch-seg-btn${priceMode === 'amounts' ? ' active' : ''}`}
                      onClick={() => setPriceModeExplicit('amounts')}>
                      <IconCoins width={14} height={14} aria-hidden />
                      {t('launch.liq.modeAmounts')}
                    </button>
                    <button type="button" role="tab" aria-selected={priceMode === 'price'}
                      className={`launch-seg-btn${priceMode === 'price' ? ' active' : ''}`}
                      onClick={() => setPriceModeExplicit('price')}>
                      <IconInfo width={14} height={14} aria-hidden />
                      {t('launch.liq.modePrice')}
                    </button>
                  </div>

                  <div className="launch-amount-card">
                    <div className="launch-amount">
                      <div className="launch-amount-head">
                        <label className="field-label" htmlFor="launch-token-amt">{t('launch.liq.tokenAmount')}</label>
                        {supplyValid && (
                          <span className="launch-pct-row" aria-label={t('launch.liq.ofSupply')}>
                            {[10, 25, 50, 100].map((p) => (
                              <button key={p} type="button" className="launch-pct"
                                onClick={() => setTokenPct(p)} title={t('launch.liq.ofSupply')}>
                                {p}%
                              </button>
                            ))}
                          </span>
                        )}
                      </div>
                      <div className="launch-amount-box">
                        <input id="launch-token-amt" className="launch-amount-input mono" inputMode="decimal"
                          value={tokenAmount} placeholder="100000"
                          onChange={(e) => setTokenAmount(numOnly(e.target.value))} />
                        <span className="launch-amount-sym">{symbol || 'TOKEN'}</span>
                      </div>
                    </div>
                    <div className="launch-amount">
                      <div className="launch-amount-head">
                        <label className="field-label" htmlFor="launch-quote-amt">{t('launch.liq.quoteAmount')}</label>
                        {wallet.address && balanceInfo && (
                          <span className="launch-bal">
                            {t('launch.liq.balance')}: <span className="mono">{balanceInfo.human} {quoteSym}</span>
                            {!quote?.native && (
                              <button type="button" className="launch-pct max" onClick={setQuoteMax}>
                                {t('launch.liq.max')}
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                      <div className={`launch-amount-box${priceMode === 'price' ? ' derived' : ''}`}>
                        <input id="launch-quote-amt" className="launch-amount-input mono" inputMode="decimal"
                          value={quoteAmount} placeholder="10000"
                          readOnly={priceMode === 'price'}
                          onChange={(e) => setQuoteAmount(numOnly(e.target.value))} />
                        <span className="launch-amount-sym">{quoteSym}</span>
                      </div>
                      {priceMode === 'price' && (
                        <p className="launch-hint">{t('launch.liq.computedFromPrice')}</p>
                      )}
                    </div>
                    <div className="launch-amount">
                      <div className="launch-amount-head">
                        <label className="field-label" htmlFor="launch-price">{t('launch.liq.price')}</label>
                        {priceMode === 'amounts' && amountValid && (
                          <span className="launch-auto-badge">{t('launch.liq.computed')}</span>
                        )}
                      </div>
                      <div className={`launch-amount-box${priceMode === 'amounts' ? ' derived' : ''}`}>
                        <input id="launch-price" className="launch-amount-input mono" inputMode="decimal"
                          value={priceShown}
                          readOnly={priceMode === 'amounts'}
                          placeholder={priceMode === 'price' ? '0.1' : '—'}
                          onChange={(e) => setInitialPrice(numOnly(e.target.value))} />
                        <span className="launch-amount-sym">1 {symbol || 'TOKEN'} = {quoteSym}</span>
                      </div>
                      {priceMode === 'amounts' && (
                        <p className="launch-hint">
                          {amountValid && impliedPrice != null
                            ? `${t('launch.liq.priceImplied')}: ${compactNum(impliedPrice, 6)} ${quoteSym}`
                            : t('launch.liq.priceHint')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="launch-field">
                    <div className="launch-amount-head">
                      <label className="field-label">{t('launch.liq.slippage')}</label>
                      <span className="launch-slip-val mono">{slippage}%</span>
                    </div>
                    <div className="launch-pct-row slip">
                      {[0.5, 1, 3].map((p) => (
                        <button key={p} type="button"
                          className={`launch-pct${slippage === p ? ' active' : ''}`}
                          onClick={() => setSlippage(p)}>
                          {p}%
                        </button>
                      ))}
                    </div>
                    <input type="range" min={0.5} max={10} step={0.5} value={slippage}
                      onChange={(e) => setSlippage(Number(e.target.value))} className="launch-range"
                      aria-label={t('launch.liq.slippage')} />
                  </div>
                  <div className="launch-liq-summary">
                    <div className="launch-liq-row">
                      <span>{t('launch.liq.feeTier')}</span>
                      <span className="mono">{dex ? (dex.feeTierBps / 100).toFixed(2) : '—'}%</span>
                    </div>
                    <div className="launch-liq-row">
                      <span>{t('launch.liq.tvl')}</span>
                      <span className="mono">{amountValid ? `≈ ${quoteAmount} ${quoteSym}` : '—'}</span>
                    </div>
                  </div>
                  <InfoBox tone="info" title={t('launch.liq.lpTitle')}>
                    {t('launch.liq.lpBody')}
                  </InfoBox>
                  {/* Money-critical warnings are ALWAYS visible, with the full
                      text INSIDE the box — never collapsed behind a tap. */}
                  {risk && risk.findings.some((f) => f.id === 'thinLiquidity') && (
                    <LaunchAlert tone="warn" icon={<IconShield width={16} height={16} />}
                      title={t('launch.risk.finding.thinLiquidity')}>
                      {t('launch.risk.finding.thinLiquidityBody')}
                    </LaunchAlert>
                  )}
                </section>
              )}

              {/* ── STEP 5 — REVIEW ── */}
              {step === 4 && (
                <section className="launch-section">
                  <h2 className="launch-h2">{t('launch.review.title')}</h2>

                  <div className="launch-review-card">
                    <div className="launch-review-hero">
                      {logo
                        ? <img className="launch-logo lg" src={logo} alt="" />
                        : <ChainMark color={meta?.color || '#00e5ff'} short={symbol?.slice(0, 3) || meta?.short || '?'} size={56} />}
                      <div className="launch-review-id">
                        <p className="launch-review-name">{name || '—'} <span className="launch-review-sym">{symbol}</span></p>
                        <p className="launch-review-sub">{chain?.name} · {dex?.name || ''}</p>
                      </div>
                      <ChainMark color={meta?.color || '#00e5ff'} short={meta?.short || '?'} size={30} ghost chain={meta?.chainId ?? chainId} />
                    </div>
                    <ReviewRow k={t('launch.review.supply')} v={spec ? `${spec.supplyHuman} ${symbol}` : '—'} mono />
                    <ReviewRow k={t('launch.review.price')} v={impliedPrice != null ? `1 ${symbol} = ${compactNum(impliedPrice, 6)} ${quoteSym}` : '—'} mono />
                    <ReviewRow k={t('launch.review.liquidity')} v={amountValid ? `${tokenAmount} ${symbol} + ${quoteAmount} ${quoteSym}` : '—'} mono />
                    <ReviewRow k={t('launch.review.fee')} v={`${launchFee} ${quoteSym} (${LAUNCH_FEES.launchFeeBps / 100}%)`} mono />
                    <ReviewRow k={t('launch.review.swapFee')} v={`${LAUNCH_FEES.swapFeeBps / 100}%`} mono />
                    <ReviewRow k={t('launch.review.deployMode')} v={directDeploy ? t('launch.mode.directFull') : t('launch.mode.factoryFull')} />
                    <ReviewRow k={t('launch.review.signatures')} v={t('launch.review.signaturesCount', { n: sigCount })} />
                  </div>

                  {/* The address the user is about to create — shown BEFORE the
                      signature, in direct mode. It is recomputed from the live
                      nonce right before signing and then verified on-chain
                      against the receipt; the wording says exactly that. */}
                  {directDeploy && plan?.predictedTokenAddress && (
                    <div className="launch-predicted">
                      <p className="launch-predicted-title">{t('launch.review.predictedTitle')}</p>
                      <p className="launch-predicted-addr mono">{plan.predictedTokenAddress}</p>
                      <p className="launch-hint">{t('launch.review.predictedNote')}</p>
                    </div>
                  )}

                  {/* Two money gates, always visible, text inside the box. The old
                      title rendered the RAW template ("موجودی {{sym}} کافی
                      نیست") because the interpolation was never passed. */}
                  {wallet.address && balanceInfo && balanceInfo.enough === false && (
                    <LaunchAlert tone="warn" icon={<IconWallet width={16} height={16} />}
                      title={t('launch.review.noQuoteBalance', { sym: quoteSym })}>
                      {t('launch.review.noQuoteBalanceBody', { sym: quoteSym })}
                    </LaunchAlert>
                  )}

                  {wallet.address && balanceInfo && balanceInfo.gasOk === false && (
                    <LaunchAlert tone="danger" icon={<IconShield width={16} height={16} />}
                      title={t('launch.review.noGas')}>
                      {t('launch.review.noGasBody', { native: chain?.native?.symbol || '', chain: chain?.name || '' })}
                    </LaunchAlert>
                  )}

                  {risk && (
                    <div className={`launch-risk ${risk.band}`}>
                      <div className="launch-risk-head">
                        <span className="launch-risk-ico" aria-hidden>
                          <IconShield width={18} height={18} />
                        </span>
                        <span className="launch-risk-score">{risk.score}</span>
                        <span className="launch-risk-band">{t(`launch.risk.band.${risk.band}`)}</span>
                      </div>
                      <div className="launch-risk-bar"><div style={{ width: `${risk.score}%` }} /></div>
                      <ul className="launch-findings">
                        {risk.findings.filter((f) => f.weight > 0).map((f) => (
                          <li key={f.id} className={`finding ${f.severity}`}>
                            <span className="finding-mark" aria-hidden>
                              {f.severity === 'high' ? <IconX width={11} height={11} />
                                : f.severity === 'medium' ? <IconShield width={11} height={11} />
                                  : <IconInfo width={11} height={11} />}
                            </span>
                            {t(f.key)}
                          </li>
                        ))}
                        {risk.findings.filter((f) => f.weight === 0).map((f) => (
                          <li key={f.id} className="finding info">
                            <span className="finding-mark" aria-hidden><IconCheck width={11} height={11} /></span>
                            {t(f.key)}
                          </li>
                        ))}
                      </ul>
                      {risk.blocked && (
                        <div className="launch-gates">
                          {risk.gates.map((g) => (
                            <p key={g.id} className="launch-gate">
                              <IconX width={12} height={12} aria-hidden /> {t(g.key)}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {risk?.confirmRequired && (
                    <div className="launch-confirm-box">
                      <p>{t('launch.review.confirmWarn')}</p>
                      <input className="launch-input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                        placeholder={symbol} autoCapitalize="characters" />
                    </div>
                  )}

                  {/* Wallet gate: connect IN PLACE. The button below never
                      navigates to /wallet — the sheet opens over the wizard
                      and every typed value survives connecting. */}
                  {!wallet.address ? (
                    <button type="button" className="launch-wallet-cta" onClick={() => setConnectOpen(true)}>
                      <span className="launch-wallet-cta-ico" aria-hidden>
                        <IconWallet width={20} height={20} />
                      </span>
                      <span className="launch-wallet-cta-text">
                        <span className="launch-wallet-cta-title">{t('launch.review.connectWallet')}</span>
                        <span className="launch-wallet-cta-sub">{t('launch.review.connectSub')}</span>
                      </span>
                    </button>
                  ) : (
                    <div className="launch-wallet-ok">
                      <span className="launch-wallet-ok-ico" aria-hidden>
                        <IconCheck width={13} height={13} />
                      </span>
                      <span className="launch-wallet-ok-text">
                        {t('launch.review.walletReady')} · <span className="mono">{shortAddress(wallet.address)}</span>
                      </span>
                      <button type="button" className="launch-wallet-ok-change" onClick={() => setConnectOpen(true)}>
                        {t('launch.review.changeWallet')}
                      </button>
                    </div>
                  )}

                  <div className="btn-row">
                    <button type="button" className="btn btn-ghost" onClick={() => setStep(3)} disabled={planning}>
                      {t('launch.back')}
                    </button>
                    <button type="button" className="btn btn-primary launch-cta" onClick={onLaunch}
                      disabled={!launchReady && Boolean(wallet.address)}>
                      {planning ? <span className="spinner spinner-sm" /> : <IconRocket width={16} height={16} />} {t('launch.review.launch')}
                    </button>
                  </div>
                </section>
              )}

              {/* wizard nav (steps 0–3) */}
              {step < 4 && (
                <div className="btn-row launch-nav">
                  <button type="button" className="btn btn-ghost" onClick={() => (step === 0 ? navigate(-1) : setStep(step - 1))}>
                    {t('launch.back')}
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => setStep(step + 1)} disabled={!canNext}>
                    {t('launch.next')}
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {view === 'running' && launch && (
            <motion.div key="running" className="launch-flow" variants={riseIn} initial="hidden" animate="show" exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
              <RunPanel launch={launch} t={t} onCancel={onCancelRun} chainId={launch.config.chainId} />
            </motion.div>
          )}

          {view === 'result' && launch && (
            <motion.div key="result" className="launch-flow" variants={riseIn} initial="hidden" animate="show" exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
              <ResultPanel launch={launch} t={t} onRetry={onRetryPool} onAddToSwap={onAddToSwap} onRestart={() => { setView('wizard'); setStep(4); }} explorer={chain?.explorer} chainMeta={meta} />
            </motion.div>
          )}
        </AnimatePresence>
        )}

        {/* In-place wallet connect: the wizard never unmounts behind it. */}
        <WalletConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />

        {/* history — shared: Solana launches land in the same list */}
        {(view === 'wizard' || solanaMode) && (
          <section className="launch-history">
            <div className="row-between">
              <h3 className="launch-h3">{t('launch.history.title')}</h3>
              {history.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { clearHistory(); setHistory([]); }}>
                  {t('launch.history.clear')}
                </button>
              )}
            </div>
            {history.length === 0 && <p className="launch-hint">{t('launch.history.empty')}</p>}
            {history.slice(0, 5).map((h) => {
              const hm = chainMeta.find((c) => c.chainId === h.network) || null;
              const isSol = h.network === 'solana';
              return (
                <div key={h.launchId} className="launch-history-row">
                  <ChainMark color={isSol ? '#14f195' : hm?.color || '#8892a8'} short={isSol ? 'SOL' : hm?.short || '?'} size={26} chain={isSol ? 'solana' : hm?.chainId ?? null} />
                  <span className={`launch-state-chip ${String(h.status).toLowerCase()}`}>{h.status}</span>
                  <span className="launch-history-name">{h.tokenName || h.symbol || '—'}</span>
                  <span className="launch-history-net">{h.networkName}</span>
                  {h.tokenAddress && <span className="launch-history-addr mono">{shortAddress(h.tokenAddress)}</span>}
                </div>
              );
            })}
          </section>
        )}

        {/* ── Explainers: native <details>, the same disclosure pattern the
            Help screen uses — no JS state, keyboard-accessibly openable, and
            one chevron that rotates on [open]. They sit BELOW the wizard and
            the result panel so they never push the actual flow down. ── */}
        <section className="launch-explains">
          <details className="launch-disclosure">
            <summary className="launch-disclosure-head">
              <span className="launch-disclosure-ico" aria-hidden><IconRocket width={16} height={16} /></span>
              <span className="launch-disclosure-text">
                <span className="launch-disclosure-title">{t('launch.howTitle')}</span>
                <span className="launch-disclosure-sub">{t('launch.howSub')}</span>
              </span>
              <span className="launch-disclosure-caret" aria-hidden>⌄</span>
            </summary>
            <div className="launch-disclosure-body">
              <ol className="launch-how">
                {[1, 2, 3, 4, 5].map((n) => (
                  <li key={n} className="launch-how-step">
                    <span className="launch-how-num" aria-hidden>{n}</span>
                    <span className="launch-how-text">{t(`launch.howStep${n}`)}</span>
                  </li>
                ))}
              </ol>
              <p className="launch-how-note">{t('launch.howNote')}</p>
            </div>
          </details>

          <details className="launch-disclosure warn">
            <summary className="launch-disclosure-head">
              <span className="launch-disclosure-ico warn" aria-hidden>⚠</span>
              <span className="launch-disclosure-text">
                <span className="launch-disclosure-title">{t('launch.warnTitle')}</span>
                <span className="launch-disclosure-sub">{t('launch.warnSub')}</span>
              </span>
              <span className="launch-disclosure-caret" aria-hidden>⌄</span>
            </summary>
            <div className="launch-disclosure-body">
              <ul className="launch-warns">
                {[1, 2, 3, 4, 5].map((n) => (
                  <li key={n} className="launch-warn-item">
                    <span className="launch-warn-mark" aria-hidden>•</span>
                    <span>{t(`launch.warn${n}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </section>

        <footer className="launch-footer">
          <p>
            <IconLock width={13} height={13} aria-hidden />
            {' '}{t('launch.footer.statement')}
          </p>
        </footer>
      </div>
    </PageTransition>
  );
}

/* ─────────────────────────── sub-views ─────────────────────────────── */

/*
 * ChainMark — the modern network logo used everywhere a chain needs a face:
 * chain cards, the token-logo fallback ("no logo → network mark"), history.
 * A layered gradient built from the chain's own colour + its short code, so
 * it works offline, in both themes, with zero image requests.
 */
/*
 * Reported: «در لانچ باید شبکه‌ها لوگو مناسب و مدرن داشته باشند». The letter
 * tile («BAS», «ARB») was the whole mark. Now the REAL network logo — the
 * vendored, inline SVG the rest of the app already uses (AssetIcon's
 * `chainSvg`: Ethereum, BNB, Arbitrum, Polygon, Base, Optimism, Avalanche,
 * Solana…) — sits inside the same glowing ring, so it is one image request
 * short of zero and works in both themes. The letter tile remains ONLY for a
 * chain no logo exists for, and for a user token with no uploaded logo.
 */
function ChainMark({ color = '#00e5ff', short = '?', size = 40, dim = false, ghost = false, chain = null }) {
  const label = String(short || '?').slice(0, 3).toUpperCase();
  const logo = chain != null ? chainSvg(chain) : null;
  return (
    <span
      className={`launch-mark${dim ? ' dim' : ''}${ghost ? ' ghost' : ''}${logo ? ' has-logo' : ''}`}
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.26)),
        '--mark-color': color
      }}
    >
      <span className="launch-mark-ring" />
      {logo
        ? <span className="launch-mark-logo" dangerouslySetInnerHTML={{ __html: logo }} />
        : <span className="launch-mark-letter">{label}</span>}
    </span>
  );
}

/*
 * LaunchAlert — the money-warning box. Unlike InfoBox (collapsible, for
 * education), this is ALWAYS open with the full text INSIDE the box: a
 * balance or liquidity warning nobody reads is not a warning.
 */
function LaunchAlert({ tone = 'warn', icon, title, children }) {
  return (
    <div className={`launch-alert ${tone}`} role="alert">
      <span className="launch-alert-ico" aria-hidden>{icon}</span>
      <div className="launch-alert-body">
        <p className="launch-alert-title">{title}</p>
        <div className="launch-alert-text">{children}</div>
      </div>
    </div>
  );
}

function ReviewRow({ k, v, mono = false }) {
  return (
    <div className="launch-review-row">
      <span className="launch-review-k">{k}</span>
      <span className={`launch-review-v${mono ? ' mono' : ''}`}>{v}</span>
    </div>
  );
}

function RiskPill({ risk, t }) {
  return (
    <div className={`launch-risk inline ${risk.band}`}>
      <span className="launch-risk-score sm">{risk.score}</span>
      <span>{t(`launch.risk.band.${risk.band}`)}</span>
    </div>
  );
}

/*
 * Named failure → plain language. The engine keeps the machine-readable code
 * (that is what the probes assert on); the panel translates the ones a user
 * can actually act on and falls back to the raw code for anything else —
 * never to a generic "something went wrong", which would hide the reason a
 * launch stopped.
 */
const RUN_ERR_CODES = [
  'DIRECT_CODE_MISMATCH', 'DIRECT_NO_CODE', 'DIRECT_ADDRESS_MISMATCH',
  'DIRECT_TX_REVERTED', 'DIRECT_TX_NOT_DEPLOY', 'DIRECT_RECEIPT_ADDRESS_MISSING',
  'DIRECT_PREDICTED_ADDRESS_MISSING', 'TOKEN_EVENT_NOT_FOUND', 'TX_REVERTED',
  'USER_REJECTED', 'NO_SIGNER', 'SIGNER_UNAVAILABLE',
  'CHAIN_SWITCH_REJECTED', 'CHAIN_SWITCH_TIMEOUT'
];

function errorText(t, raw) {
  const code = String(raw || '').split(':')[0].trim();
  if (RUN_ERR_CODES.includes(code)) {
    const body = t(`launch.run.err.${code}`);
    // i18next returns the key itself when it is missing — fall back to the code.
    return body === `launch.run.err.${code}` ? code : body;
  }
  return String(raw || '');
}

function RunPanel({ launch, t, onCancel, chainId }) {
  const steps = launch.steps;
  const directStep = steps.find((s) => s.deploy);
  return (
    <div className="launch-run">
      <h2 className="launch-h2">{t('launch.run.title')}</h2>
      {directStep?.predictedAddress && (
        <div className="launch-predicted">
          <p className="launch-predicted-title">{t('launch.review.predictedTitle')}</p>
          <p className="launch-predicted-addr mono">{directStep.predictedAddress}</p>
          <p className="launch-hint">{t('launch.run.predictedNote')}</p>
        </div>
      )}
      <ol className="launch-run-list">
        {steps.map((s) => (
          <li key={s.id} className={`launch-run-step ${s.status}`}>
            <span className="launch-run-ico" aria-hidden>
              {s.status === 'confirmed' ? <IconCheck width={13} height={13} />
                : s.status === 'failed' ? <IconX width={13} height={13} />
                  : s.status === 'signing' || s.status === 'submitted' ? <span className="spinner spinner-sm" />
                    : s.status === 'skipped' ? '—' : <span className="launch-run-dot" />}
            </span>
            <div className="launch-run-info">
              <p className="launch-run-name">{t(stepLabel(s.id))}</p>
              {s.error
                ? <p className="launch-run-desc err">{errorText(t, s.error)}</p>
                : <p className="launch-run-desc">{s.description || t(`launch.run.state.${s.status}`)}</p>}
              {s.txHash && (
                <a className="launch-run-hash mono" href={explorerTx(chainId, s.txHash)} target="_blank" rel="noreferrer">
                  {shortAddress(s.txHash, 6)} <IconExternal width={11} height={11} aria-hidden />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="launch-hint">{t('launch.run.signatureNote')}</p>
      <div className="btn-row">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {t('launch.run.cancel')}
        </button>
      </div>
    </div>
  );
}

function CopyAddr({ addr, explorer, t }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable — the link still works */ }
  }, [addr]);
  return (
    <span className="launch-addr-row">
      <a className="mono launch-result-addr" href={`${explorer}/token/${addr}`} target="_blank" rel="noreferrer">
        {addr} <IconExternal width={11} height={11} aria-hidden />
      </a>
      <button type="button" className={`launch-copy${copied ? ' done' : ''}`} onClick={copy}
        aria-label={t('launch.result.copy')}>
        {copied ? <IconCheck width={13} height={13} aria-hidden /> : <IconCopy width={13} height={13} aria-hidden />}
      </button>
    </span>
  );
}

function ResultPanel({ launch, t, onRetry, onAddToSwap, onRestart, explorer, chainMeta }) {
  const { state, token, pool, partial } = launch;
  const live = state === 'LIVE';
  return (
    <div className={`launch-result ${live ? 'live' : 'partial'}`}>
      <div className={`launch-result-banner ${live ? 'ok' : 'warn'}`}>
        <span className="launch-result-ico" aria-hidden>
          {live ? <IconTrophy width={26} height={26} /> : <IconShield width={26} height={26} />}
        </span>
        <div className="launch-result-banner-text">
          <h2>{live ? t('launch.result.live') : t('launch.result.partialTitle')}</h2>
          <p>
            {live
              ? t('launch.result.liveBody')
              : (partial
                ? t('launch.result.partialBody', { token: partial.token, pool: partial.pool })
                : t('launch.result.failedBody'))}
          </p>
        </div>
        {chainMeta && (
          <ChainMark color={chainMeta.color || '#00e5ff'} short={chainMeta.short || '?'} size={34} ghost chain={chainMeta.chainId ?? null} />
        )}
      </div>

      {token && (
        <div className="launch-result-card">
          <p className="launch-result-label">{t('launch.result.token')}</p>
          <p className="launch-result-name">{token.name} ({token.symbol})</p>
          <CopyAddr addr={token.address} explorer={explorer} t={t} />
          {/* How the token came to exist, and what was proven about it: in
              direct mode the bytecode at that address was compared with the
              published token bytecode, byte for byte. */}
          <p className="launch-hint">
            {token.mode === 'direct' || token.codeVerified
              ? t('launch.result.directNote')
              : t('launch.result.factoryNote')}
          </p>
        </div>
      )}
      {pool?.address && (
        <div className="launch-result-card">
          <p className="launch-result-label">{t('launch.result.pool')}</p>
          <CopyAddr addr={pool.address} explorer={explorer} t={t} />
          {pool.lpBalance && <p className="launch-hint">{t('launch.result.lp')} — <span className="mono">{pool.lpBalance}</span></p>}
        </div>
      )}

      <div className="btn-row">
        {live && (
          <button type="button" className="btn btn-success" onClick={onAddToSwap}>
            {t('launch.result.addSwap')}
          </button>
        )}
        {(state === 'RETRYABLE' || state === 'EXPIRED') && (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            {t('launch.result.retryPool')}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onRestart}>
          {t('launch.result.newLaunch')}
        </button>
      </div>
    </div>
  );
}


