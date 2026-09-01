import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWallet } from '../../context/WalletContext';
import { fmtUsd } from '../../lib/format';
import { notifyTrade } from '../../lib/notify';
import { requestSoftRefresh } from '../../lib/refresh';
import {
  crossChainService,
  fromBaseUnits,
  isQuoteExpired,
  isSolanaChain,
  toBaseUnits,
  validateDestinationAddress
} from '../../services/cross-chain';
import CrossChainQuoteCard from './CrossChainQuoteCard';
import CrossChainStatus, { chainName } from './CrossChainStatus';
import CrossChainHistory from './CrossChainHistory';
import '../../styles/cross-chain.css';

/**
 * CROSS-CHAIN DESK — one screen, real end to end.
 * ---------------------------------------------------------------------------
 * From → To → amount → REAL routes from LI.FI → the best one, itemised →
 * the user's own wallet signs → the server tracks the transfer to the
 * DESTINATION → history → portfolio refresh.
 *
 * ─── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 * · No hard-coded chain menu. The list comes from the provider, intersected
 *   with the chains this wallet can sign for.
 * · No hard-coded token table. The registry is the provider's, searchable.
 * · No rate that survives its own expiry. The quote countdown re-quotes.
 * · No "Completed" without a destination transaction hash — that decision is
 *   the server's and this component only renders it.
 *
 * ─── SEQUENCE (spec §18) ────────────────────────────────────────────────────
 * confirm → refresh quote → balance → allowance → chain → destination →
 * build → signature → broadcast → track source → track bridge → track
 * destination → confirm. All of it lives in crossChainService.execute(); this
 * file is the surface that reports each step honestly while it happens.
 */

const DEBOUNCE_MS = 550;

/* A refresh a few seconds before expiry keeps a live number on screen without
   the user ever seeing a dead one. */
const REFRESH_MARGIN_MS = 4000;

function shortAddr(a) {
  const s = String(a || '');
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

/** Token picker: search over the provider's registry for one chain. */
function TokenPicker({ chainId, value, onChange, label, balance = null, disabled = false }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [state, setState] = useState('idle');

  useEffect(() => {
    if (!open || chainId == null) return undefined;
    let alive = true;
    setState('loading');
    const id = setTimeout(() => {
      crossChainService.getTokens(chainId, { search, limit: 40 })
        .then((tokens) => { if (alive) { setRows(tokens); setState('ready'); } })
        .catch(() => { if (alive) { setRows([]); setState('unavailable'); } });
    }, 250);
    return () => { alive = false; clearTimeout(id); };
  }, [open, chainId, search]);

  return (
    <div className="xcc-token">
      <button
        type="button"
        className="xcc-token-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
      >
        <span className="xcc-token-label">{label}</span>
        <span className="xcc-token-value" dir="ltr">
          {value?.symbol || t('crossChain.selectToken', { defaultValue: 'Select token' })}
        </span>
        {balance != null && (
          <span className="xcc-token-balance" dir="ltr">
            {Number(balance).toLocaleString(undefined, { maximumFractionDigits: 6 })}
            {value?.priceUSD ? ` · ${fmtUsd(Number(balance) * Number(value.priceUSD))}` : ''}
          </span>
        )}
      </button>

      {open && (
        <div className="xcc-token-sheet">
          <input
            className="xcc-search"
            dir="ltr"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('crossChain.searchToken', { defaultValue: 'Search symbol or paste contract' })}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
          />
          {state === 'loading' && <p className="xcc-note">{t('crossChain.loading', { defaultValue: 'Loading…' })}</p>}
          {state === 'unavailable' && (
            <p className="xcc-error">{t('crossChain.tokensUnavailable', { defaultValue: 'The token registry is unavailable for this chain.' })}</p>
          )}
          <div className="xcc-token-list">
            {rows.map((token) => (
              <button
                type="button"
                key={`${token.chainId}-${token.address}`}
                className="xcc-token-row"
                onClick={() => { onChange(token); setOpen(false); setSearch(''); }}
              >
                <span className="xcc-token-sym" dir="ltr">{token.symbol}</span>
                <span className="xcc-token-name" dir="ltr">{token.name}</span>
                <span className="xcc-token-addr mono" dir="ltr">{shortAddr(token.address)}</span>
                {token.priceUSD ? <span className="xcc-token-price mono">{fmtUsd(Number(token.priceUSD))}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CrossChainDesk({ source = 'intent-os', initial = null, onExecuted = null }) {
  const { t } = useTranslation();
  const wallet = useWallet();

  /* ── provider health: no health, no rates ─────────────────────────────── */
  const [health, setHealth] = useState(null);
  const [chains, setChains] = useState([]);
  const [chainsState, setChainsState] = useState('loading');

  useEffect(() => {
    let alive = true;
    crossChainService.getHealth().then((h) => { if (alive) setHealth(h); });
    crossChainService.getChains()
      .then((list) => { if (alive) { setChains(list); setChainsState(list.length ? 'ready' : 'empty'); } })
      .catch(() => { if (alive) { setChains([]); setChainsState('unavailable'); } });
    return () => { alive = false; };
  }, []);

  /* ── form ─────────────────────────────────────────────────────────────── */
  const [fromChain, setFromChain] = useState(initial?.fromChain ?? 8453);
  const [toChain, setToChain] = useState(initial?.toChain ?? 1);
  const [fromToken, setFromToken] = useState(null);
  const [toToken, setToToken] = useState(null);
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [destination, setDestination] = useState('');
  const [showDestination, setShowDestination] = useState(false);

  /* ── quote/route state ────────────────────────────────────────────────── */
  const [routes, setRoutes] = useState([]);
  const [selectedTool, setSelectedTool] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [expired, setExpired] = useState(false);

  /* ── execution state ──────────────────────────────────────────────────── */
  const [busy, setBusy] = useState(false);
  const [execStep, setExecStep] = useState(null);
  const [execError, setExecError] = useState(null);
  const [transaction, setTransaction] = useState(null);
  const [changedQuote, setChangedQuote] = useState(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [balance, setBalance] = useState(null);

  const seq = useRef(0);
  const timerRef = useRef(null);
  const stopTrackRef = useRef(null);
  const acceptChangeRef = useRef(null);

  const solanaSource = isSolanaChain(fromChain);
  const crossFamily = isSolanaChain(fromChain) !== isSolanaChain(toChain);

  const evmConnected = Boolean(wallet?.isConnected && wallet?.address);
  const [solanaAddr, setSolanaAddr] = useState(null);
  useEffect(() => {
    let alive = true;
    import('../../lib/solanaWallet.js').then((m) => { if (alive) setSolanaAddr(m.solanaAddress()); }).catch(() => {});
    return () => { alive = false; };
  }, [fromChain, toChain]);

  const senderAddress = solanaSource ? solanaAddr : (wallet?.address || null);
  const walletReady = Boolean(senderAddress);
  const wrongNetwork = Boolean(!solanaSource && evmConnected && Number(wallet.chainId) !== Number(fromChain));

  const providerDown = health && health.ok === false
    && health.components?.some((c) => c.component === 'lifi' && c.ok === false);

  /* Default tokens: the chain's most liquid stable is a sane starting point,
     resolved from the REGISTRY rather than a hard-coded address table. */
  useEffect(() => {
    let alive = true;
    setFromToken(null);
    crossChainService.resolveToken(fromChain, 'USDC')
      .then((token) => { if (alive) setFromToken(token); })
      .catch(() => { /* the picker still works; the user chooses */ });
    return () => { alive = false; };
  }, [fromChain]);

  useEffect(() => {
    let alive = true;
    setToToken(null);
    crossChainService.resolveToken(toChain, 'USDC')
      .then((token) => { if (alive) setToToken(token); })
      .catch(() => {});
    return () => { alive = false; };
  }, [toChain]);

  /* Real balance for the selected source token, read from a chain node. */
  useEffect(() => {
    let alive = true;
    setBalance(null);
    if (!fromToken || solanaSource || !wallet?.address || !wallet?.getReadProvider) return undefined;
    (async () => {
      try {
        const provider = await wallet.getReadProvider(Number(fromChain));
        const zero = /^0x0{40}$/i.test(fromToken.address) || /^0xe{40}$/i.test(fromToken.address);
        if (zero) {
          const wei = await provider.getBalance(wallet.address);
          if (alive) setBalance(Number(fromBaseUnits(wei.toString(), fromToken.decimals ?? 18)));
          return;
        }
        const { Contract } = await import('ethers');
        const erc20 = new Contract(fromToken.address, ['function balanceOf(address) view returns (uint256)'], provider);
        const raw = await erc20.balanceOf(wallet.address);
        if (alive) setBalance(Number(fromBaseUnits(raw.toString(), fromToken.decimals ?? 18)));
      } catch {
        if (alive) setBalance(null);
      }
    })();
    return () => { alive = false; };
  }, [fromToken, fromChain, wallet, solanaSource]);

  /* ── destination address rules (spec §12, §13) ────────────────────────── */
  const destinationRequired = crossFamily;
  const effectiveDestination = destination.trim() || (crossFamily ? '' : senderAddress || '');
  const destinationCheck = effectiveDestination
    ? validateDestinationAddress(effectiveDestination, toChain)
    : { ok: !destinationRequired, code: 'DESTINATION_REQUIRED' };

  useEffect(() => {
    /* The field appears only when it is actually needed — crossing families,
       or because the user asked to send somewhere else. */
    if (crossFamily) setShowDestination(true);
  }, [crossFamily]);

  /* ── quoting ──────────────────────────────────────────────────────────── */

  const baseAmount = useMemo(
    () => (fromToken ? toBaseUnits(amount, fromToken.decimals ?? 18) : null),
    [amount, fromToken]
  );

  const runQuote = useCallback(async ({ silent = false } = {}) => {
    const mine = ++seq.current;
    if (!fromToken || !toToken || !baseAmount || baseAmount === '0') {
      setRoutes([]);
      setQuote(null);
      return;
    }
    if (String(fromChain) === String(toChain)) {
      setQuoteError('SAME_CHAIN');
      return;
    }
    if (destinationRequired && !destinationCheck.ok) {
      setQuoteError(destinationCheck.code);
      return;
    }
    if (providerDown) {
      setQuoteError('PROVIDER_UNAVAILABLE');
      return;
    }

    if (!silent) setQuoting(true);
    setQuoteError(null);
    try {
      const params = {
        fromChain,
        toChain,
        fromToken: fromToken.address,
        toToken: toToken.address,
        fromAmount: baseAmount,
        fromAddress: senderAddress || '',
        toAddress: effectiveDestination || ''
      };
      const list = await crossChainService.getRoutes(params);
      if (seq.current !== mine) return;
      setRoutes(list.routes);

      const chosen = list.routes.find((r) => r.tool === selectedTool) || list.best;
      setSelectedTool(chosen?.tool ?? null);

      /* With a wallet we also pull the EXECUTABLE quote for the chosen tool —
         a route object carries no transactionRequest and must never be
         presented as something that can be signed. */
      if (senderAddress && chosen) {
        try {
          const executable = await crossChainService.getQuote({ ...params, preferTool: chosen.tool });
          if (seq.current !== mine) return;
          setQuote(executable);
        } catch (err) {
          if (seq.current !== mine) return;
          /* The comparison still stands; only signing is unavailable. */
          setQuote({ ...chosen, executable: false });
          setQuoteError(err.code === 'NO_ROUTE' ? null : err.code);
        }
      } else {
        setQuote(chosen ? { ...chosen, indicative: true } : null);
      }
      setExpired(false);
    } catch (err) {
      if (seq.current !== mine) return;
      setRoutes([]);
      setQuote(null);
      setQuoteError(err.code || 'QUOTE_FAILED');
    } finally {
      if (seq.current === mine) setQuoting(false);
    }
  }, [baseAmount, destinationCheck.ok, destinationCheck.code, destinationRequired, effectiveDestination,
      fromChain, fromToken, providerDown, selectedTool, senderAddress, toChain, toToken]);

  /* Debounced re-quote on every input that changes the price. */
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runQuote(), DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromChain, toChain, fromToken?.address, toToken?.address, baseAmount, senderAddress, effectiveDestination]);

  /* Expiry → automatic refresh, with the honest "the previous rate expired"
     line shown by the quote card while the new one is in flight. */
  useEffect(() => {
    if (!quote?.expiresAt || busy || transaction) return undefined;
    const due = Number(quote.expiresAt) - Date.now() - REFRESH_MARGIN_MS;
    const id = setTimeout(() => {
      setExpired(true);
      runQuote({ silent: true });
    }, Math.max(1000, due));
    return () => clearTimeout(id);
  }, [quote?.expiresAt, busy, transaction, runQuote]);

  /* A wallet that switches network must re-quote: gas, and sometimes the
     route itself, are chain-specific (spec §11). */
  useEffect(() => {
    if (!evmConnected) return;
    if (Number(wallet.chainId) === Number(fromChain)) runQuote({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.chainId]);

  useEffect(() => () => stopTrackRef.current?.(), []);

  /* ── execution ────────────────────────────────────────────────────────── */

  const track = useCallback((row) => {
    stopTrackRef.current?.();
    stopTrackRef.current = crossChainService.trackTransaction(row.id, {
      onUpdate: (updated) => {
        if (!updated) return;
        setTransaction(updated);
        if (updated.executionStatus === 'COMPLETED') {
          notifyTrade({
            ok: true,
            title: t('crossChain.notify.completedTitle', { defaultValue: 'Cross-chain transfer completed' }),
            body: `${updated.fromTokenSymbol ?? ''} ${chainName(updated.fromChain, chains)} → ${chainName(updated.toChain, chains)}`
          });
          /* Nobody should have to pull-to-refresh after their money arrives. */
          wallet?.refreshBalance?.();
          requestSoftRefresh({ invalidate: true });
          setHistoryKey((n) => n + 1);
          onExecuted?.(updated);
        } else if (updated.executionStatus === 'FAILED') {
          notifyTrade({
            ok: false,
            title: t('crossChain.notify.failedTitle', { defaultValue: 'Cross-chain transfer failed' }),
            body: updated.failureReason || ''
          });
          setHistoryKey((n) => n + 1);
        }
      }
    });
  }, [chains, onExecuted, t, wallet]);

  const submit = useCallback(async () => {
    if (!quote) return;
    setBusy(true);
    setExecError(null);
    setChangedQuote(null);
    setExecStep('confirm');

    const result = await crossChainService.execute(quote, {
      wallet,
      destination: effectiveDestination,
      source,
      onStep: (step) => setExecStep(step),
      confirmQuoteChange: async (fresh) => {
        /* The rate moved between display and signature. Stop, show the new
           number, and wait for a second, explicit yes. */
        setChangedQuote(fresh);
        return new Promise((resolve) => { acceptChangeRef.current = resolve; });
      }
    });

    setBusy(false);
    setExecStep(null);

    if (!result.ok) {
      if (result.code === 'QUOTE_CHANGED') {
        setQuote(result.quote);
        setExecError(null);
        return;
      }
      setChangedQuote(null);
      setExecError(result.code);
      if (result.code !== 'USER_REJECTED') {
        notifyTrade({
          ok: false,
          title: t('crossChain.notify.failedTitle', { defaultValue: 'Cross-chain transfer failed' }),
          body: result.detail || result.code
        });
      }
      return;
    }

    setChangedQuote(null);
    notifyTrade({
      ok: true,
      title: t('crossChain.notify.startedTitle', { defaultValue: 'Cross-chain transfer started' }),
      body: t('crossChain.notify.startedBody', { defaultValue: 'Source transaction sent. Tracking the destination…' })
    });
    setHistoryKey((n) => n + 1);

    if (result.transaction) {
      setTransaction(result.transaction);
      track(result.transaction);
    } else {
      /* The transfer is on chain but the ledger write failed: say exactly
         that instead of pretending either success or failure. */
      setExecError(result.ledgerError || 'HISTORY_WRITE_FAILED');
    }
  }, [effectiveDestination, quote, source, t, track, wallet]);

  const acceptNewQuote = () => {
    acceptChangeRef.current?.(true);
    acceptChangeRef.current = null;
    setChangedQuote(null);
  };
  const rejectNewQuote = () => {
    acceptChangeRef.current?.(false);
    acceptChangeRef.current = null;
    setChangedQuote(null);
  };

  const refreshStatus = useCallback(async () => {
    if (!transaction) return;
    try {
      const payload = await crossChainService.getStatus(transaction.id);
      setTransaction(payload.transaction);
    } catch { /* the row keeps its real status */ }
  }, [transaction]);

  const flip = () => {
    setFromChain(toChain);
    setToChain(fromChain);
    setAmount('');
    setQuote(null);
    setRoutes([]);
  };

  /* ── render ───────────────────────────────────────────────────────────── */

  const chainOptions = chains.length
    ? chains
    : /* Nothing invented: with no registry the selector shows the two chains
         already chosen and the panel explains why it is empty. */
      [{ id: fromChain, name: chainName(fromChain) }, { id: toChain, name: chainName(toChain) }];

  const canSubmit = Boolean(
    quote?.executable && walletReady && !busy && !quoting
    && destinationCheck.ok && !wrongNetwork && !isQuoteExpired(quote)
  );

  return (
    <div className="xcc-desk">
      {providerDown && (
        <div className="xcc-banner bad">
          {t('crossChain.providerDown', {
            defaultValue: 'The routing provider is unavailable right now, so no rate is shown. Nothing is estimated while it is down.'
          })}
        </div>
      )}
      {chainsState === 'unavailable' && !providerDown && (
        <div className="xcc-banner bad">
          {t('crossChain.chainsUnavailable', { defaultValue: 'Chain list unavailable — the cross-chain service cannot be reached.' })}
        </div>
      )}

      <section className="ios-panel xcc-ticket">
        <div className="xcc-leg">
          <span className="xcc-leg-label">{t('crossChain.from', { defaultValue: 'From' })}</span>
          <div className="xcc-leg-row">
            <select
              className="xcc-select"
              value={fromChain}
              onChange={(e) => setFromChain(Number(e.target.value))}
            >
              {chainOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <TokenPicker
              chainId={fromChain}
              value={fromToken}
              onChange={setFromToken}
              label={t('crossChain.token', { defaultValue: 'Token' })}
              balance={balance}
            />
          </div>
          <div className="xcc-amount-row">
            <input
              className="xcc-amount"
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              dir="ltr"
            />
            {balance != null && balance > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAmount(String(balance))}>
                {t('crossChain.max', { defaultValue: 'MAX' })}
              </button>
            )}
          </div>
        </div>

        <button type="button" className="xcc-flip" onClick={flip} aria-label={t('crossChain.flip', { defaultValue: 'Swap direction' })}>↓</button>

        <div className="xcc-leg">
          <span className="xcc-leg-label">{t('crossChain.to', { defaultValue: 'To' })}</span>
          <div className="xcc-leg-row">
            <select
              className="xcc-select"
              value={toChain}
              onChange={(e) => setToChain(Number(e.target.value))}
            >
              {chainOptions.filter((c) => String(c.id) !== String(fromChain)).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <TokenPicker
              chainId={toChain}
              value={toToken}
              onChange={setToToken}
              label={t('crossChain.token', { defaultValue: 'Token' })}
            />
          </div>
        </div>

        {/* Destination address: shown only when it is genuinely needed. */}
        {(showDestination || crossFamily) && (
          <label className="xcc-field">
            <span>
              {isSolanaChain(toChain)
                ? t('crossChain.solanaAddress', { defaultValue: 'Solana destination address' })
                : t('crossChain.destinationAddress', { defaultValue: 'Destination address' })}
            </span>
            <input
              dir="ltr"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder={crossFamily
                ? (isSolanaChain(toChain) ? 'Base58 Solana address' : '0x…')
                : (senderAddress || '0x…')}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
            />
            {destination && !destinationCheck.ok && (
              <em className="xcc-error">{t(`crossChain.err.${destinationCheck.code}`, { defaultValue: destinationCheck.code })}</em>
            )}
            {!destination && !crossFamily && senderAddress && (
              <em className="xcc-note">
                {t('crossChain.defaultDestination', { defaultValue: 'Default: your connected wallet ({{addr}})', addr: shortAddr(senderAddress) })}
              </em>
            )}
          </label>
        )}
        {!showDestination && !crossFamily && (
          <button type="button" className="btn btn-ghost btn-sm xcc-linkish" onClick={() => setShowDestination(true)}>
            {t('crossChain.sendElsewhere', { defaultValue: 'Send to a different address' })}
          </button>
        )}

        {/* Wallet gates — connect, then the right network, then quote. */}
        {!walletReady && (
          <p className="xcc-banner">
            {solanaSource
              ? t('crossChain.connectSolana', { defaultValue: 'Connect a Solana wallet to bridge from Solana.' })
              : t('crossChain.connectWallet', { defaultValue: 'Connect a wallet to get an executable quote.' })}
          </p>
        )}
        {wrongNetwork && (
          <div className="xcc-banner warn">
            <span>
              {t('crossChain.wrongNetwork', {
                defaultValue: 'Your wallet must switch to {{chain}} to continue.',
                chain: chainName(fromChain, chains)
              })}
            </span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={async () => {
                try {
                  await wallet.switchChain?.(Number(fromChain));
                  /* Quote refresh after a switch is automatic — see the
                     wallet.chainId effect above. */
                } catch { /* the wallet showed its own rejection */ }
              }}
            >
              {t('crossChain.switchNetwork', { defaultValue: 'Switch network' })}
            </button>
          </div>
        )}

        {quoting && <div className="xcc-skeleton"><div className="skel" /><div className="skel" /><div className="skel" /></div>}

        {quoteError && !quoting && (
          <p className="xcc-error">{t(`crossChain.err.${quoteError}`, { defaultValue: quoteError })}</p>
        )}

        {quote && !quoting && (
          <CrossChainQuoteCard quote={quote} expired={expired} refreshing={quoting} />
        )}

        {/* The alternatives, with the winner explained rather than asserted. */}
        {routes.length > 1 && (
          <div className="xcc-routes">
            <div className="xcc-routes-head">{t('crossChain.routesTitle', { defaultValue: 'Routes compared' })}</div>
            {routes.slice(0, 4).map((r) => (
              <button
                type="button"
                key={r.quoteId}
                className={`xcc-route${r.tool === selectedTool ? ' active' : ''}`}
                onClick={() => { setSelectedTool(r.tool); runQuote({ silent: true }); }}
              >
                <span className="xcc-route-name" dir="ltr">
                  {r.best ? '★ ' : ''}{r.toolName || r.tool}
                </span>
                <span className="xcc-route-out mono" dir="ltr">
                  {r.toTokenDetail?.decimals != null
                    ? Number(fromBaseUnits(r.toAmount, r.toTokenDetail.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })
                    : r.toAmount}
                  {' '}{r.toTokenDetail?.symbol || ''}
                </span>
                <span className="xcc-route-meta mono">
                  {fmtUsd((r.gasCostUsd || 0) + (r.bridgeFeeUsd || 0) + (r.protocolFeeUsd || 0))}
                  {r.estimatedTime ? ` · ${r.estimatedTime < 90 ? `${r.estimatedTime}s` : `${Math.round(r.estimatedTime / 60)}m`}` : ''}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* The rate moved while confirming: a second, explicit yes. */}
        {changedQuote && (
          <div className="xcc-banner warn xcc-changed">
            <strong>{t('crossChain.quoteChangedTitle', { defaultValue: 'The rate changed while confirming.' })}</strong>
            <CrossChainQuoteCard quote={changedQuote} compact />
            <div className="xcc-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={acceptNewQuote}>
                {t('crossChain.acceptNewRate', { defaultValue: 'Accept new rate' })}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={rejectNewQuote}>
                {t('crossChain.cancel', { defaultValue: 'Cancel' })}
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary xcc-submit"
          disabled={!canSubmit}
          onClick={submit}
        >
          {busy
            ? t(`crossChain.step.${execStep || 'confirm'}`, { defaultValue: 'Working…' })
            : t('crossChain.createIntent', { defaultValue: 'Create intent' })}
        </button>

        {execError && (
          <p className="xcc-error">{t(`crossChain.err.${execError}`, { defaultValue: execError })}</p>
        )}
      </section>

      {transaction && (
        <section className="ios-panel">
          <CrossChainStatus transaction={transaction} chains={chains} onRefresh={refreshStatus} busy={busy} />
        </section>
      )}

      <CrossChainHistory wallet={senderAddress} chains={chains} refreshKey={historyKey} />
    </div>
  );
}
