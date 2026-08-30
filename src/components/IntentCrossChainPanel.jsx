import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isAddress, keccak256 } from 'ethers';
import { useWallet } from '../context/WalletContext';
import { BRIDGE_CHAINS, tokensFor } from '../lib/bridge';
import {
  buildCrossChainStatePlan,
  createSettlementState,
  fetchSettlementState,
  forgetLocalStateId,
  forgetStateKeys,
  generatePartyKey,
  getAtomicSwapStatus,
  listLocalStateIds,
  loadStateKeys,
  planAtomicSwap,
  quoteSourceLeg,
  rememberLocalStateId,
  saveStateKeys,
  signLegReceipt,
  submitLegReceipt,
} from '../lib/intentCrossChainClient';
import { toBaseUnits } from '../lib/bridge';

const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

function fmtCountdown(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds <= 0) return 'expired';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function StatusChip({ ok, children }) {
  return <span className={`icc-chip ${ok ? 'ok' : 'no'}`}>{children}</span>;
}

/**
 * INTENT OS — Cross-chain desk (Phase 153 wiring).
 *
 * Connects the browser to the real Phase 4b sequential settlement machine and
 * the real Phase 4d HTLC atomic swap. Ed25519 keys are generated and kept on
 * this device; the server receives public keys, signatures and tx hashes only.
 * Sequential plans NEVER claim atomicity — the honest labels are baked into
 * the server's schema and surfaced here verbatim.
 */
export default function IntentCrossChainPanel({ networkStatus }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();

  const sequentialReady = Boolean(networkStatus?.crossChain?.available);
  const htlc = networkStatus?.atomicSwap || null;

  /* planner form */
  const [fromChain, setFromChain] = useState(56);
  const [toChain, setToChain] = useState(42161);
  const [tokenSymbol, setTokenSymbol] = useState('USDT');
  const [amountHuman, setAmountHuman] = useState('100');
  const [counterpartyId, setCounterpartyId] = useState('counterparty-wallet');
  const [bothSides, setBothSides] = useState(false);
  const [windowHours, setWindowHours] = useState(48);

  /* quote + state lifecycle */
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [activeStateId, setActiveStateId] = useState(null);
  const [stateDoc, setStateDoc] = useState(null);
  const [stateError, setStateError] = useState(null);

  /* leg recording */
  const [sourceTx, setSourceTx] = useState('');
  const [destTx, setDestTx] = useState('');
  const [legBusy, setLegBusy] = useState(false);
  const [legError, setLegError] = useState(null);

  /* HTLC */
  const [htlcStatus, setHtlcStatus] = useState(null);
  const [htlcBusy, setHtlcBusy] = useState(false);
  const [htlcError, setHtlcError] = useState(null);
  const [htlcPlan, setHtlcPlan] = useState(null);
  const [htlcCounterparty, setHtlcCounterparty] = useState('');

  const localStates = useMemo(() => listLocalStateIds(), [activeStateId]);

  const fromTokens = tokensFor(fromChain);
  const decimals = useMemo(
    () => fromTokens.find((tk) => tk.symbol === tokenSymbol)?.decimals ?? 18,
    [fromTokens, tokenSymbol]
  );

  useEffect(() => {
    let alive = true;
    getAtomicSwapStatus()
      .then((s) => { if (alive) setHtlcStatus(s); })
      .catch(() => { if (alive) setHtlcStatus(null); });
    return () => { alive = false; };
  }, []);

  const loadState = useCallback(async (stateId) => {
    setStateError(null);
    try {
      const doc = await fetchSettlementState(stateId);
      setActiveStateId(stateId);
      setStateDoc(doc);
    } catch (error) {
      setStateDoc(null);
      setStateError(error.code || error.message);
    }
  }, []);

  const runQuote = useCallback(async () => {
    setQuoting(true);
    setQuoteError(null);
    setQuote(null);
    try {
      const base = toBaseUnits(amountHuman || '0', decimals);
      if (!/^[1-9][0-9]*$/.test(base)) throw Object.assign(new Error('BAD_AMOUNT'), { code: 'BAD_AMOUNT' });
      const q = await quoteSourceLeg({ fromChain, toChain, amount: base, token: tokenSymbol });
      setQuote(q);
    } catch (error) {
      setQuoteError(error.code || error.message);
    } finally {
      setQuoting(false);
    }
  }, [fromChain, toChain, tokenSymbol, amountHuman, decimals]);

  const createPlan = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const base = toBaseUnits(amountHuman || '0', decimals);
      const initiatorKeys = { id: 'initiator-on-this-device', ...generatePartyKey() };
      const counterpartyKeys = bothSides
        ? { id: counterpartyId || 'counterparty-on-this-device', ...generatePartyKey() }
        : { id: counterpartyId || 'counterparty-wallet', publicKey: generatePartyKey().publicKey };
      // When both sides live here, keep the counterparty key locally too — an
      // honest, clearly-labeled rehearsal mode; the label travels in the party id.
      const built = await buildCrossChainStatePlan({
        createdAt: Date.now(),
        windowHours,
        source: { chainId: fromChain, token: { symbol: tokenSymbol, address: (fromTokens.find((tk) => tk.symbol === tokenSymbol)?.address), native: false, decimals }, amount: base },
        destination: { chainId: toChain, token: { symbol: tokenSymbol, address: (tokensFor(toChain).find((tk) => tk.symbol === tokenSymbol)?.address), native: false, decimals }, amount: base },
        parties: { initiator: initiatorKeys, counterparty: counterpartyKeys }
      });
      if (!built.ok) throw Object.assign(new Error(built.code), { code: built.code });
      const stored = await createSettlementState(built.state);
      saveStateKeys(built.state.stateId, {
        initiator: initiatorKeys.privateKey,
        ...(bothSides ? { counterparty: counterpartyKeys.privateKey } : {}),
        counterpartyIdLocal: bothSides ? counterpartyKeys.id : null
      });
      rememberLocalStateId(built.state.stateId, { fromChain, toChain, token: tokenSymbol, amount: amountHuman });
      setActiveStateId(built.state.stateId);
      setStateDoc(stored);
    } catch (error) {
      setCreateError(error.code || error.message);
    } finally {
      setCreating(false);
    }
  }, [amountHuman, bothSides, counterpartyId, creating, decimals, fromChain, fromTokens, tokenSymbol, toChain, windowHours]);

  const recordLeg = useCallback(async (leg) => {
    if (!stateDoc?.state) return;
    setLegBusy(true);
    setLegError(null);
    try {
      const txHash = leg === 'source-transfer' ? sourceTx.trim() : destTx.trim();
      const keys = loadStateKeys(stateDoc.state.stateId);
      const seed = leg === 'source-transfer' ? keys?.initiator : keys?.counterparty;
      if (!seed) throw Object.assign(new Error('KEY_MISSING'), { code: 'KEY_MISSING' });
      const signed = await signLegReceipt(
        { state: stateDoc.state, priorReceipts: stateDoc.receipts || [], leg, txHash },
        seed
      );
      if (!signed.ok) throw Object.assign(new Error(signed.code), { code: signed.code });
      const updated = await submitLegReceipt(stateDoc.state.stateId, signed.receipt);
      setStateDoc(updated);
      if (leg === 'source-transfer') setSourceTx(''); else setDestTx('');
    } catch (error) {
      setLegError(error.code || error.message);
    } finally {
      setLegBusy(false);
    }
  }, [stateDoc, sourceTx, destTx]);

  const buildHtlcPlan = useCallback(async () => {
    setHtlcBusy(true);
    setHtlcError(null);
    setHtlcPlan(null);
    try {
      if (!wallet?.address) throw Object.assign(new Error('CONNECT_WALLET'), { code: 'CONNECT_WALLET' });
      if (!isAddress(htlcCounterparty)) throw Object.assign(new Error('ATOMIC_SWAP_BAD_RECIPIENT'), { code: 'ATOMIC_SWAP_BAD_RECIPIENT' });
      // Preimage stays on this device; only its keccak256 (the contract's
      // hashlock — the claim() verifier) is shared.
      const preimage = crypto.getRandomValues(new Uint8Array(32));
      const preimageHex = `0x${[...preimage].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
      const hashlock = keccak256(preimage);
      const nowSec = Math.floor(Date.now() / 1000);
      const plan = await planAtomicSwap({
        hashlock,
        source: {
          chainId: fromChain,
          sender: wallet.address,
          recipient: htlcCounterparty,
          token: { symbol: tokenSymbol, address: fromTokens.find((tk) => tk.symbol === tokenSymbol)?.address, native: false, decimals },
          amount: toBaseUnits(amountHuman || '0', decimals),
          timeout: nowSec + 3600 + 7200
        },
        destination: {
          chainId: toChain,
          sender: htlcCounterparty,
          recipient: wallet.address,
          token: { symbol: tokenSymbol, address: tokensFor(toChain).find((tk) => tk.symbol === tokenSymbol)?.address, native: false, decimals },
          amount: toBaseUnits(amountHuman || '0', decimals),
          timeout: nowSec + 3600
        }
      });
      setHtlcPlan({ ...plan, preimageHex });
      try { sessionStorage.setItem(`fbt.htlc.preimage.${plan.swapId}`, preimageHex); } catch { /* device-only */ }
    } catch (error) {
      setHtlcError(error.code || error.message);
    } finally {
      setHtlcBusy(false);
    }
  }, [amountHuman, decimals, fromChain, fromTokens, htlcCounterparty, tokenSymbol, toChain, wallet?.address]);

  const sourceLeg = stateDoc?.state ? {
    done: (stateDoc.receipts || []).some((r) => r.leg === 'source-transfer'),
    deadline: stateDoc.state.timeout.sourceSignatureBy
  } : null;
  const destLeg = stateDoc?.state ? {
    done: (stateDoc.receipts || []).some((r) => r.leg === 'destination-transfer')
  } : null;
  const nowSec = Math.floor(Date.now() / 1000);
  const hasLocalCounterparty = Boolean(stateDoc?.state && loadStateKeys(stateDoc.state.stateId)?.counterparty);

  return (
    <div className="icc-desk">
      {/* ── protocol status ── */}
      <section className="ios-panel icc-status">
        <h3>{t('intentOS.crossChain.deskTitle', { defaultValue: 'Cross-chain desk' })}</h3>
        <div className="icc-chips">
          <StatusChip ok={sequentialReady}>
            {sequentialReady
              ? t('intentOS.crossChain.sequentialReady', { defaultValue: 'Sequential settlement: protocol ready' })
              : t('intentOS.crossChain.sequentialOff', { defaultValue: 'Sequential settlement: server unavailable' })}
          </StatusChip>
          <StatusChip ok={Boolean(htlc?.crossChainAtomic)}>
            {htlc?.crossChainAtomic
              ? t('intentOS.crossChain.htlcReady', { defaultValue: 'HTLC atomic: contracts configured' })
              : t('intentOS.crossChain.htlcOff', { defaultValue: 'HTLC atomic: contracts not configured' })}
          </StatusChip>
          <StatusChip ok={Boolean(wallet?.address)}>
            {wallet?.address
              ? t('intentOS.crossChain.walletOn', { defaultValue: 'Wallet connected' })
              : t('intentOS.crossChain.walletOff', { defaultValue: 'Wallet not connected' })}
          </StatusChip>
        </div>
        <p className="icc-note">{t('intentOS.crossChain.modeNote', {
          defaultValue: 'Sequential mode = two user-signed transfers tracked by signed statements (NOT atomic). Atomic mode = HTLC contract escrow, only when configured. Keys never leave this device.'
        })}</p>
      </section>

      {/* ── planner ── */}
      <section className="ios-panel icc-planner">
        <h3>{t('intentOS.crossChain.planTitle', { defaultValue: '1) Plan a cross-chain exchange' })}</h3>
        <div className="icc-grid">
          <label>
            <span>{t('intentOS.crossChain.from', { defaultValue: 'From chain' })}</span>
            <select value={fromChain} onChange={(e) => setFromChain(Number(e.target.value))}>
              {BRIDGE_CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>
            <span>{t('intentOS.crossChain.to', { defaultValue: 'To chain' })}</span>
            <select value={toChain} onChange={(e) => setToChain(Number(e.target.value))}>
              {BRIDGE_CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>
            <span>{t('intentOS.crossChain.token', { defaultValue: 'Token' })}</span>
            <select value={tokenSymbol} onChange={(e) => setTokenSymbol(e.target.value)}>
              {fromTokens.map((tk) => <option key={tk.symbol} value={tk.symbol}>{tk.symbol}</option>)}
            </select>
          </label>
          <label>
            <span>{t('intentOS.crossChain.amount', { defaultValue: 'Amount' })}</span>
            <input inputMode="decimal" value={amountHuman} onChange={(e) => setAmountHuman(e.target.value)} />
          </label>
          <label>
            <span>{t('intentOS.crossChain.counterparty', { defaultValue: 'Counterparty id' })}</span>
            <input value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)} />
          </label>
          <label>
            <span>{t('intentOS.crossChain.window', { defaultValue: 'Source window (hours)' })}</span>
            <input type="number" min="1" max="720" value={windowHours} onChange={(e) => setWindowHours(Number(e.target.value) || 48)} />
          </label>
        </div>
        <label className="icc-check">
          <input type="checkbox" checked={bothSides} onChange={(e) => setBothSides(e.target.checked)} />
          <span>{t('intentOS.crossChain.bothSides', {
            defaultValue: 'Both sides on this device (rehearsal mode — counterparty key stored locally, clearly labeled)'
          })}</span>
        </label>
        <div className="icc-actions">
          <button type="button" className="btn btn-ghost" disabled={quoting} onClick={runQuote}>
            {quoting ? t('intentOS.crossChain.quoting', { defaultValue: 'Quoting…' }) : t('intentOS.crossChain.getQuote', { defaultValue: 'Get real bridge quote' })}
          </button>
          <button type="button" className="btn btn-primary" disabled={creating} onClick={createPlan}>
            {creating ? t('intentOS.crossChain.creating', { defaultValue: 'Creating…' }) : t('intentOS.crossChain.createPlan', { defaultValue: 'Create settlement plan' })}
          </button>
        </div>
        {quoteError && <p className="icc-error"><code>{quoteError}</code></p>}
        {quote && (
          <div className="icc-quote">
            <strong>{t('intentOS.crossChain.quoteTitle', { defaultValue: 'Live quote (LI.FI via FBT server)' })}</strong>
            <pre dir="ltr">{JSON.stringify(quote, (k, v) => (typeof v === 'string' && v.length > 160 ? `${v.slice(0, 160)}…` : v), 2).slice(0, 1600)}</pre>
          </div>
        )}
        {createError && <p className="icc-error"><code>{createError}</code></p>}
      </section>

      {/* ── active state ── */}
      {stateDoc?.state && (
        <section className="ios-panel icc-state">
          <h3>{t('intentOS.crossChain.stateTitle', { defaultValue: '2) Settlement state' })}</h3>
          <div className="icc-mono" dir="ltr">{stateDoc.state.stateId.slice(0, 18)}…{stateDoc.state.stateId.slice(-8)}</div>
          {stateDoc.status && <div className="icc-mono">{t('intentOS.crossChain.derivedStatus', { defaultValue: 'server status' })}: {stateDoc.status}{stateDoc.nextLeg ? ` → ${stateDoc.nextLeg}` : ''}</div>}
          <ul className="icc-legs">
            <li>
              <StatusChip ok={!sourceLeg?.done && sourceLeg && nowSec <= sourceLeg.deadline}>{sourceLeg?.done ? t('intentOS.crossChain.legRecorded', { defaultValue: 'recorded' }) : t('intentOS.crossChain.legOpen', { defaultValue: 'open' })}</StatusChip>
              <div>
                <strong>{t('intentOS.crossChain.legSource', { defaultValue: 'Leg 1 — source transfer' })}</strong>
                <small>{stateDoc.state.source.token.symbol} → chain {stateDoc.state.source.chainId} · window {fmtCountdown(sourceLeg?.deadline - nowSec)}</small>
                <div className="icc-leg-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => navigate(`/bridge?fromChain=${stateDoc.state.source.chainId}&toChain=${stateDoc.state.destination.chainId}&token=${encodeURIComponent(stateDoc.state.source.token.symbol)}&amount=${Number(BigInt(stateDoc.state.source.amount) / (10n ** BigInt(stateDoc.state.source.token.decimals)))}`)}
                  >
                    {t('intentOS.crossChain.openBridge', { defaultValue: 'Open bridge handoff' })}
                  </button>
                  <input dir="ltr" placeholder="0x… tx hash" value={sourceTx} onChange={(e) => setSourceTx(e.target.value)} />
                  <button type="button" className="btn btn-primary btn-sm" disabled={legBusy || !TX_HASH_RE.test(sourceTx.trim())} onClick={() => recordLeg('source-transfer')}>
                    {t('intentOS.crossChain.signRecord', { defaultValue: 'Sign & record' })}
                  </button>
                </div>
              </div>
            </li>
            <li>
              <StatusChip ok={destLeg?.done}>{destLeg?.done ? t('intentOS.crossChain.legRecorded', { defaultValue: 'recorded' }) : t('intentOS.crossChain.legWaiting', { defaultValue: 'awaiting counterparty' })}</StatusChip>
              <div>
                <strong>{t('intentOS.crossChain.legDest', { defaultValue: 'Leg 2 — destination transfer' })}</strong>
                <small>{stateDoc.state.destination.token.symbol} ← chain {stateDoc.state.destination.chainId}</small>
                {hasLocalCounterparty ? (
                  <div className="icc-leg-actions">
                    <input dir="ltr" placeholder="0x… tx hash" value={destTx} onChange={(e) => setDestTx(e.target.value)} />
                    <button type="button" className="btn btn-primary btn-sm" disabled={legBusy || !TX_HASH_RE.test(destTx.trim())} onClick={() => recordLeg('destination-transfer')}>
                      {t('intentOS.crossChain.signRecord', { defaultValue: 'Sign & record' })}
                    </button>
                  </div>
                ) : (
                  <p className="icc-note">{t('intentOS.crossChain.counterpartyNote', {
                    defaultValue: 'The counterparty signs this leg from their own session with their device key. (Rehearsal mode keeps both keys here, labeled.)'
                  })}</p>
                )}
              </div>
            </li>
          </ul>
          {legError && <p className="icc-error"><code>{legError}</code></p>}
          {(stateDoc.receipts || []).length > 0 && (
            <div className="icc-receipts">
              <strong>{t('intentOS.crossChain.receipts', { defaultValue: 'Signed receipts (claims — on-chain verification below)' })}</strong>
              {(stateDoc.receipts || []).map((r) => (
                <div className="icc-receipt" key={r.receiptId}>
                  <code dir="ltr">{r.leg} · {r.txHash.slice(0, 14)}… · signed by {r.signer.id}</code>
                  {r.onChainVerified === true
                    ? <StatusChip ok>{t('intentOS.crossChain.verified', { defaultValue: 'on-chain verified' })}</StatusChip>
                    : <StatusChip ok={false}>{t('intentOS.crossChain.unverified', { defaultValue: 'claim only' })}</StatusChip>}
                </div>
              ))}
            </div>
          )}
          <p className="icc-note">{t('intentOS.crossChain.stateNote', {
            defaultValue: 'History is immutable: every transition is a signed statement pinned to the plan and the prior receipt. If the destination misses its window, the refund leg returns the source transfer.'
          })}</p>
        </section>
      )}
      {stateError && <p className="icc-error"><code>{stateError}</code></p>}

      {/* ── local states ── */}
      {localStates.length > 0 && (
        <section className="ios-panel icc-local">
          <h3>{t('intentOS.crossChain.localTitle', { defaultValue: 'This device’s plans' })}</h3>
          <div className="icc-local-list">
            {localStates.map((row) => (
              <div className="icc-local-row" key={row.stateId}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadState(row.stateId)}>
                  {row.token} {row.amount} · {row.fromChain}→{row.toChain}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { forgetLocalStateId(row.stateId); forgetStateKeys(row.stateId); setActiveStateId(null); setStateDoc(null); }}
                >
                  {t('intentOS.crossChain.forget', { defaultValue: 'Forget keys locally' })}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── HTLC atomic ── */}
      <section className="ios-panel icc-htlc">
        <h3>{t('intentOS.crossChain.htlcTitle', { defaultValue: 'Atomic option — HTLC contract escrow' })}</h3>
        {htlcStatus ? (
          <>
            <div className="icc-chips">
              <StatusChip ok={Boolean(htlcStatus.crossChainAtomic)}>
                {htlcStatus.crossChainAtomic ? t('intentOS.crossChain.htlcReady', { defaultValue: 'HTLC atomic: contracts configured' }) : t('intentOS.crossChain.htlcOff', { defaultValue: 'HTLC atomic: contracts not configured' })}
              </StatusChip>
              <span className="icc-chip">{htlcStatus.configuredChainCount ?? 0} {t('intentOS.crossChain.chainsConfigured', { defaultValue: 'chains configured' })}</span>
              <span className="icc-chip">{htlcStatus.mechanism ?? 'hash-timelock-contract-escrow'}</span>
            </div>
            {htlcStatus.crossChainAtomic ? (
              <>
                <label className="icc-grid" style={{ marginTop: 10 }}>
                  <label>
                    <span>{t('intentOS.crossChain.htlcCounterparty', { defaultValue: 'Counterparty address (EVM)' })}</span>
                    <input dir="ltr" placeholder="0x…" value={htlcCounterparty} onChange={(e) => setHtlcCounterparty(e.target.value)} />
                  </label>
                </label>
                <div className="icc-actions">
                  <button type="button" className="btn btn-primary" disabled={htlcBusy || !isAddress(htlcCounterparty)} onClick={buildHtlcPlan}>
                    {htlcBusy ? t('intentOS.crossChain.building', { defaultValue: 'Building…' }) : t('intentOS.crossChain.buildHtlc', { defaultValue: 'Build atomic swap plan (preimage stays on device)' })}
                  </button>
                </div>
              </>
            ) : (
              <p className="icc-note"><code>INTENT_ATOMIC_SWAP_ADDRESSES</code> — {t('intentOS.crossChain.htlcMissing', { defaultValue: 'deploy IntentAtomicSwap on ≥2 chains and set the addresses; until then atomic cross-chain stays honestly unavailable.' })}</p>
            )}
            {htlcError && <p className="icc-error"><code>{htlcError}</code></p>}
            {htlcPlan && (
              <div className="icc-quote">
                <strong>{t('intentOS.crossChain.htlcPlanTitle', { defaultValue: 'Two user-signed legs (server never sends)' })}</strong>
                {htlcPlan.legs?.map((leg) => (
                  <div key={leg.role} className="icc-receipt">
                    <code dir="ltr">{leg.role}: chain {leg.chainId} → {leg.to?.slice(0, 10)}… {leg.configured ? '' : '· CONTRACT NOT CONFIGURED'}</code>
                  </div>
                ))}
                <p className="icc-note">{t('intentOS.crossChain.htlcPreimage', { defaultValue: 'The preimage is stored only in this browser session. Losing it before claiming = refund path only.' })}</p>
              </div>
            )}
          </>
        ) : (
          <p className="icc-note">{t('intentOS.crossChain.htlcStatusUnavailable', { defaultValue: 'Atomic swap status unavailable from the server.' })}</p>
        )}
      </section>
    </div>
  );
}
