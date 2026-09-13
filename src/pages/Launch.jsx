import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import Switch from '../components/Switch';
import { useWallet, shortAddress } from '../context/WalletContext';
import { EVM_CHAINS, explorerTx } from '../lib/chains';
import {
  LAUNCH_CHAINS,
  SOLANA_LAUNCH_STATUS,
  describeAllLaunchChains,
  quoteAssetsFor
} from '../lib/launch/networks';
import { CAPABILITIES, capsToBitmap, validateTokenSpec } from '../lib/launch/capabilities';
import { scoreLaunch, bandFor } from '../lib/launch/risk';
import { computeLaunchFee, LAUNCH_FEES } from '../lib/launch/fees';
import {
  buildLaunchPlan,
  buildLiquiditySteps,
  verifyDex,
  getExistingPair,
  parseTokenCreatedLog,
  FACTORY_ABI
} from '../lib/launch/calldata';
import * as engine from '../lib/launch/engine';
import { verifyLaunch } from '../lib/launch/verify';
import { listHistory, recordLaunch, clearHistory } from '../lib/launch/history';
import { fetchLaunchConfig, postLaunchRecord } from '../lib/launch/api';
import { importTokenByAddress } from '../lib/tokenLists';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAppStore } from '../store/useAppStore';
import '../styles/launch.css';

const STEPS = ['network', 'token', 'rules', 'liquidity', 'review'];

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

  useEffect(() => {
    let alive = true;
    fetchLaunchConfig().then((r) => {
      if (!alive || !r.ok || !r.json) return;
      const cfg = r.json;
      if (cfg && cfg.networks) {
        setChainMeta(cfg.networks);
        setConfigSource('api');
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // DEX anchor verification for the selected chain — the runtime proof that
  // the DEX factory constant is the real one (see networks.js header).
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
  }, [chainId, wallet.address, wallet.chainId]);

  const chain = EVM_CHAINS[chainId];
  const meta = chainMeta.find((c) => c.chainId === chainId) || null;
  const dex = meta?.dex || null;
  const factoryAddress = meta?.fbtFactory || null;
  const dexOk = dexCheck[chainId]?.ok === true;
  const dexChecking = dexCheck[chainId]?.checking === true;
  const factoryReady = Boolean(factoryAddress);

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

  // price-mode helper: entering a price + token amount fills the quote amount
  useEffect(() => {
    if (priceMode !== 'price') return;
    const p = Number(initialPrice);
    const ta = Number(tokenAmount);
    if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(ta) || ta <= 0) return;
    setQuoteAmount(String(Number((p * ta).toPrecision(12))));
  }, [initialPrice, tokenAmount, priceMode]);

  useEffect(() => {
    if (priceMode !== 'price' || !amountValid) return;
    setInitialPrice(String(Number((Number(quoteAmount) / Number(tokenAmount)).toPrecision(12))));
  }, [quoteAmount, amountValid, priceMode]);

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
      factoryReady,
      lpqToUser: true
    });
  }, [spec, amountValid, tokenAmount, quoteAmount, quote, dexOk, factoryReady]);

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
      case 0: return dexOk && factoryReady;
      case 1: return specResult.ok;
      case 2: return true;
      case 3: return Boolean(quote) && amountValid && !risk?.blocked;
      default: return false;
    }
  }, [step, dexOk, factoryReady, specResult.ok, quote, amountValid, risk]);

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
    if (st.id === 'create-token') {
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
        await runStep(cur, next);
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
  const [balanceInfo, setBalanceInfo] = useState(null);

  const doPlan = useCallback(async () => {
    if (!spec || !quote || !amountValid) return;
    setPlanning(true);
    try {
      const p = await buildLaunchPlan({
        chainId,
        factoryAddress,
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
  }, [spec, quote, amountValid, chainId, factoryAddress, tokenAmount, quoteAmount, slippage, wallet.address, notify]);

  useEffect(() => {
    if (step === 4 && !plan && !planning) doPlan();
  }, [step, plan, planning, doPlan]);

  // quote balance check for the review screen (honest, read-only)
  useEffect(() => {
    if (step !== 4 || !quote || !amountValid || !wallet.address) return;
    let alive = true;
    (async () => {
      try {
        const provider = await wallet.getReadProvider(chainId);
        let bal;
        if (quote.native) bal = (await provider.getBalance(wallet.address)).toString();
        else {
          const { Contract } = await import('ethers');
          const c = new Contract(quote.address, ['function balanceOf(address) view returns (uint256)'], provider);
          bal = (await c.balanceOf(wallet.address)).toString();
        }
        if (alive) setBalanceInfo({ wei: bal, decimals: quote.decimals, enough: BigInt(bal) >= BigInt(Math.ceil(Number(quoteAmount) * 10 ** quote.decimals)) });
      } catch {
        if (alive) setBalanceInfo(null);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, quote, amountValid, wallet.address, quoteAmount, chainId]);

  const launchReady = canNext && step === 4 && risk && !risk.blocked && (
    !risk.confirmRequired || confirmText.trim().toUpperCase() === symbol.trim().toUpperCase()
  ) && !planning && Boolean(plan);

  const onLaunch = () => {
    if (!launchReady) return;
    const l = engine.createLaunch();
    const cfg = {
      chainId,
      dex,
      factoryAddress,
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
        await runStep(l, next);
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
        <div className="launch-head">
          <div className="launch-title">
            <span className="launch-rocket" aria-hidden>🚀</span>
            <div>
              <h1>{t('launch.title')}</h1>
              <p>{t('launch.subtitle')}</p>
            </div>
          </div>
          <div className="launch-badges">
            <span className="launch-badge nc">
              <span className="launch-badge-dot" aria-hidden />
              {t('launch.nonCustodial')}
            </span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {view === 'wizard' && (
            <motion.div key="wizard" variants={riseIn} initial="hidden" animate="show" exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
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
                    <span className="launch-step-num">{i < step ? '✓' : i + 1}</span>
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
                      return (
                        <button
                          key={c.chainId}
                          type="button"
                          className={`launch-chain${chainId === c.chainId ? ' active' : ''}`}
                          onClick={() => setChainId(c.chainId)}
                          style={{ borderColor: chainId === c.chainId ? c.color : undefined }}
                        >
                          <span className="launch-chain-dot" style={{ background: c.color }} aria-hidden />
                          <span className="launch-chain-name">{c.name}</span>
                          <span className="launch-chain-dex">{t('launch.network.dex')}: {c.dex.name}</span>
                          <span className={`launch-chain-status ${c.status === 'ready' ? 'ok' : 'warn'}`}>
                            {c.status === 'ready' ? t('launch.network.ready') : t('launch.network.noFactory')}
                          </span>
                        </button>
                      );
                    })}
                    {/* Solana slot — honest coming-soon, adapter interface is ready */}
                    <div className="launch-chain soon" aria-disabled="true">
                      <span className="launch-chain-dot" style={{ background: '#14f195' }} aria-hidden />
                      <span className="launch-chain-name">Solana</span>
                      <span className="launch-chain-dex">SPL · Raydium / Meteora / Orca</span>
                      <span className="launch-chain-status warn">{t('launch.network.soon')}</span>
                    </div>
                  </div>

                  {/* DEX verification banner — the runtime proof, visible */}
                  {chain && (
                    <div className={`launch-dexcheck ${dexChecking ? 'checking' : dexOk ? 'ok' : 'bad'}`}>
                      {dexChecking && <><span className="spinner spinner-sm" /> {t('launch.network.verifying')}</>}
                      {!dexChecking && dexOk && <>✓ {t('launch.network.verified', { dex: chain.dexName || dex?.dexName })}</>}
                      {!dexChecking && !dexOk && <>⚠ {t('launch.network.verifyFailed', { reason: dexCheck[chainId]?.reason || '' })}</>}
                    </div>
                  )}

                  {!factoryReady && (
                    <InfoBox tone="warn" title={t('launch.network.factoryTitle')}>
                      {t('launch.network.factoryBody')}
                    </InfoBox>
                  )}
                </section>
              )}

              {/* ── STEP 2 — TOKEN ── */}
              {step === 1 && (
                <section className="launch-section">
                  <h2 className="launch-h2">{t('launch.token.title')}</h2>
                  <div className="launch-token-card">
                    <div className="launch-logo-row">
                      {logo
                        ? <img className="launch-logo" src={logo} alt="" />
                        : <div className="launch-logo launch-logo-ph">{(symbol || '?').slice(0, 2).toUpperCase()}</div>}
                      <label className="btn btn-ghost btn-sm">
                        {t('launch.token.logo')}
                        <input type="file" accept="image/png,image/jpeg" hidden
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const rd = new FileReader();
                            rd.onload = () => setLogo(String(rd.result));
                            rd.readAsDataURL(f);
                          }} />
                      </label>
                    </div>
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
                        onChange={(e) => setSupply(e.target.value.replace(/[^0-9.]/g, ''))} />
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
                    {CAPABILITIES.map((cap) => (
                      <div key={cap.id} className="launch-cap-row">
                        <div>
                          <p className="launch-cap-name">{t(cap.labelKey)}</p>
                          <p className="launch-cap-warn">{t(cap.warnKey)}</p>
                        </div>
                        <Switch on={Boolean(caps[cap.id])} onChange={(v) => setCaps((c) => ({ ...c, [cap.id]: v }))} />
                      </div>
                    ))}
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
                    <div className="launch-chip-row">
                      {quotes.map((q) => (
                        <button key={q.symbol} type="button"
                          className={`launch-chip${quoteSym === q.symbol ? ' active' : ''}`}
                          onClick={() => setQuoteSym(q.symbol)}>
                          {q.native ? q.symbol : q.symbol}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="launch-field-row">
                    <div className="launch-field">
                      <label className="field-label">{t('launch.liq.tokenAmount')}</label>
                      <input className="launch-input mono" inputMode="decimal" value={tokenAmount}
                        onChange={(e) => setTokenAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="100000" />
                      <span className="launch-asset-tag">{symbol || 'TOKEN'}</span>
                    </div>
                    <div className="launch-field">
                      <label className="field-label">{t('launch.liq.quoteAmount')}</label>
                      <input className="launch-input mono" inputMode="decimal" value={quoteAmount}
                        onChange={(e) => setQuoteAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="10000" />
                      <span className="launch-asset-tag">{quoteSym}</span>
                    </div>
                  </div>
                  <div className="launch-field">
                    <label className="field-label">{t('launch.liq.price')}</label>
                    <div className="launch-price-row">
                      <input className="launch-input mono" inputMode="decimal" value={initialPrice}
                        disabled={priceMode === 'amounts'}
                        onChange={(e) => { setPriceMode('price'); setInitialPrice(e.target.value.replace(/[^0-9.]/g, '')); }} />
                      <span className="launch-asset-tag">1 {symbol || 'TOKEN'} = {quoteSym}</span>
                    </div>
                    {amountValid && impliedPrice != null && (
                      <p className="launch-hint">
                        {t('launch.liq.priceImplied')}: {Number(impliedPrice.toPrecision(6))} {quoteSym}
                      </p>
                    )}
                  </div>
                  <div className="launch-field">
                    <label className="field-label">{t('launch.liq.slippage')} — {slippage}%</label>
                    <input type="range" min={0.5} max={10} step={0.5} value={slippage}
                      onChange={(e) => setSlippage(Number(e.target.value))} className="launch-range" />
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
                  {risk && risk.findings.some((f) => f.id === 'thinLiquidity') && (
                    <InfoBox tone="warn" title={t('launch.risk.finding.thinLiquidity')}>
                      {t('launch.risk.finding.thinLiquidityBody')}
                    </InfoBox>
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
                        : <div className="launch-logo launch-logo-ph lg">{(symbol || '?').slice(0, 2).toUpperCase()}</div>}
                      <div>
                        <p className="launch-review-name">{name || '—'} <span className="launch-review-sym">{symbol}</span></p>
                        <p className="launch-review-sub">{chain?.name} · {dex?.dexName}</p>
                      </div>
                    </div>
                    <ReviewRow k={t('launch.review.supply')} v={spec ? `${spec.supplyHuman} ${symbol}` : '—'} mono />
                    <ReviewRow k={t('launch.review.price')} v={impliedPrice != null ? `1 ${symbol} = ${Number(impliedPrice.toPrecision(6))} ${quoteSym}` : '—'} mono />
                    <ReviewRow k={t('launch.review.liquidity')} v={amountValid ? `${tokenAmount} ${symbol} + ${quoteAmount} ${quoteSym}` : '—'} mono />
                    <ReviewRow k={t('launch.review.fee')} v={`${launchFee} ${quoteSym} (${LAUNCH_FEES.launchFeeBps / 100}%)`} mono />
                    <ReviewRow k={t('launch.review.swapFee')} v={`${LAUNCH_FEES.swapFeeBps / 100}%`} mono />
                    <ReviewRow k={t('launch.review.signatures')} v={t('launch.review.signaturesCount', { n: sigCount })} />
                  </div>

                  {balanceInfo && !balanceInfo.enough && (
                    <InfoBox tone="warn" title={t('launch.review.noQuoteBalance')}>
                      {t('launch.review.noQuoteBalanceBody', { sym: quoteSym })}
                    </InfoBox>
                  )}

                  {risk && (
                    <div className={`launch-risk ${risk.band}`}>
                      <div className="launch-risk-head">
                        <span className="launch-risk-score">{risk.score}</span>
                        <span className="launch-risk-band">{t(`launch.risk.band.${risk.band}`)}</span>
                      </div>
                      <div className="launch-risk-bar"><div style={{ width: `${risk.score}%` }} /></div>
                      <ul className="launch-findings">
                        {risk.findings.filter((f) => f.weight > 0).map((f) => (
                          <li key={f.id} className={`finding ${f.severity}`}>
                            <span className="finding-mark" aria-hidden>{f.severity === 'high' ? '⛔' : f.severity === 'medium' ? '⚠' : '•'}</span>
                            {t(f.key)}
                          </li>
                        ))}
                        {risk.findings.filter((f) => f.weight === 0).map((f) => (
                          <li key={f.id} className="finding info">
                            <span className="finding-mark" aria-hidden>✓</span>
                            {t(f.key)}
                          </li>
                        ))}
                      </ul>
                      {risk.blocked && (
                        <div className="launch-gates">
                          {risk.gates.map((g) => <p key={g.id} className="launch-gate">⛔ {t(g.key)}</p>)}
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

                  <div className="btn-row">
                    <button type="button" className="btn btn-ghost" onClick={() => setStep(3)} disabled={planning}>
                      {t('launch.back')}
                    </button>
                    <button type="button" className="btn btn-primary launch-cta" onClick={onLaunch} disabled={!launchReady}>
                      {planning ? <span className="spinner spinner-sm" /> : '🚀'} {t('launch.review.launch')}
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
            <motion.div key="running" variants={riseIn} initial="hidden" animate="show" exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
              <RunPanel launch={launch} t={t} onCancel={onCancelRun} chainId={launch.config.chainId} />
            </motion.div>
          )}

          {view === 'result' && launch && (
            <motion.div key="result" variants={riseIn} initial="hidden" animate="show" exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
              <ResultPanel launch={launch} t={t} onRetry={onRetryPool} onAddToSwap={onAddToSwap} onRestart={() => { setView('wizard'); setStep(4); }} explorer={chain?.explorer} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* history */}
        {view === 'wizard' && (
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
            {history.slice(0, 5).map((h) => (
              <div key={h.launchId} className="launch-history-row">
                <span className={`launch-state-chip ${String(h.status).toLowerCase()}`}>{h.status}</span>
                <span className="launch-history-name">{h.tokenName || h.symbol || '—'}</span>
                <span className="launch-history-net">{h.networkName}</span>
                {h.tokenAddress && <span className="launch-history-addr mono">{shortAddress(h.tokenAddress)}</span>}
              </div>
            ))}
          </section>
        )}

        <footer className="launch-footer">
          <p>🔒 {t('launch.footer.statement')}</p>
        </footer>
      </div>
    </PageTransition>
  );
}

/* ─────────────────────────── sub-views ─────────────────────────────── */

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

function RunPanel({ launch, t, onCancel, chainId }) {
  const steps = launch.steps;
  return (
    <div className="launch-run">
      <h2 className="launch-h2">{t('launch.run.title')}</h2>
      <ol className="launch-run-list">
        {steps.map((s) => (
          <li key={s.id} className={`launch-run-step ${s.status}`}>
            <span className="launch-run-ico" aria-hidden>
              {s.status === 'confirmed' ? '✓' : s.status === 'failed' ? '✕' : s.status === 'signing' || s.status === 'submitted' ? <span className="spinner spinner-sm" /> : s.status === 'skipped' ? '—' : '•'}
            </span>
            <div className="launch-run-info">
              <p className="launch-run-name">{t(stepLabel(s.id))}</p>
              <p className="launch-run-desc">{s.description || s.error || t(`launch.run.state.${s.status}`)}</p>
              {s.txHash && (
                <a className="launch-run-hash mono" href={explorerTx(chainId, s.txHash)} target="_blank" rel="noreferrer">
                  {shortAddress(s.txHash, 6)} ↗
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

function ResultPanel({ launch, t, onRetry, onAddToSwap, onRestart, explorer }) {
  const { state, token, pool, partial } = launch;
  const live = state === 'LIVE';
  return (
    <div className={`launch-result ${live ? 'live' : 'partial'}`}>
      <div className={`launch-result-banner ${live ? 'ok' : 'warn'}`}>
        <span className="launch-result-ico" aria-hidden>{live ? '🎉' : '⚠'}</span>
        <div>
          <h2>{live ? t('launch.result.live') : t('launch.result.partialTitle')}</h2>
          <p>
            {live
              ? t('launch.result.liveBody')
              : (partial
                ? t('launch.result.partialBody', { token: partial.token, pool: partial.pool })
                : t('launch.result.failedBody'))}
          </p>
        </div>
      </div>

      {token && (
        <div className="launch-result-card">
          <p className="launch-result-label">{t('launch.result.token')}</p>
          <p className="launch-result-name">{token.name} ({token.symbol})</p>
          <a className="mono launch-result-addr" href={`${explorer}/token/${token.address}`} target="_blank" rel="noreferrer">
            {token.address} ↗
          </a>
        </div>
      )}
      {pool?.address && (
        <div className="launch-result-card">
          <p className="launch-result-label">{t('launch.result.pool')}</p>
          <a className="mono launch-result-addr" href={`${explorer}/token/${pool.address}`} target="_blank" rel="noreferrer">
            {pool.address} ↗
          </a>
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


