import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import InfoBox from '../components/InfoBox';
import { fmtQty } from '../lib/format';
import { toBaseUnits } from '../lib/bridge';
import {
  TRON_ORIGINS,
  TRON_USDT,
  getTronQuote,
  isTronAddress,
  summariseTron,
  tronAmountWarning
} from '../lib/xchain';

/**
 * BRIDGE TO TRON — the route a lot of our users actually need.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * A large share of the stablecoin our users hold is USDT on TRC-20, because
 * Tron's fees are the lowest anywhere it is widely available. `server/xchain.js`
 * has been the only route we have that reaches Tron since it was written, and
 * it had zero UI consumers — 368 lines of working code nobody could open.
 *
 * ─── STABLECOIN ONLY, AND ONE DIRECTION ─────────────────────────────────────
 * EVM → Tron USDT. Two deliberate limits:
 *
 * 1. Tron as ORIGIN earns us nothing. 0x refuse the fee fields on a Tron
 *    origin with a hard 400 — not a silent zero. The server's guard drops them
 *    so the quote still works, but there is no revenue and, more importantly,
 *    sending FROM Tron needs a Tron wallet signature which this EVM-only
 *    screen cannot produce. Offering it would be a route that dead-ends at the
 *    signing step.
 *
 * 2. Stablecoins only, same reasoning as the main bridge: a bridge takes
 *    minutes and a volatile token leaves the user unable to judge whether what
 *    arrived was fair.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── THE FLAT-COST TRAP, WHICH IS THE WHOLE REASON FOR THE WARNINGS ─────────
 * ═══════════════════════════════════════════════════════════════════════════
 * Tron charges a near-flat account-activation cost on the receiving side.
 * Measured on the same route:
 *
 *   $10 in    → 8.29 USDT   = 17.1% lost
 *   $1,000 in → 995.24 USDT =  0.48% lost
 *
 * Our fee is 0.30% in both cases. The rest is fixed, and a fixed cost is
 * invisible as a percentage until the amount is small. Structurally identical
 * to the deBridge fixed fee, and it gets the same treatment: stated as a
 * percentage, warned about loudly below a sensible amount, and never buried.
 */
const DEBOUNCE_MS = 500;

/* Canonical USDC per origin chain. Wrong addresses here send funds nowhere
   recoverable, so these mirror the constants the swap screen already uses. */
const ORIGIN_USDC = {
  8453: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  42161: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
  1: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  56: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
  137: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 }
};

export default function TronPanel() {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const wallet = useWallet();

  const [origin, setOrigin] = useState(8453);
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState('');
  const [res, setRes] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [txErr, setTxErr] = useState(null);

  const token = ORIGIN_USDC[origin];
  const destValid = isTronAddress(dest);
  const summary = useMemo(() => summariseTron(res), [res]);

  /*
   * The amount warning is computed from what the user TYPED, not from the
   * quote, so it appears before any network round-trip. Someone entering $10
   * should be told immediately, not after a spinner.
   */
  const amountWarn = useMemo(
    () => tronAmountWarning(amount === '' ? null : Number(amount)),
    [amount]
  );

  const timer = useRef(null);

  const fetchQuote = useCallback(async () => {
    setErr(null);
    setTxErr(null);
    if (!wallet.isConnected || !wallet.address) return;
    if (!token || !destValid) return;

    const raw = toBaseUnits(amount, token.decimals);
    if (!raw) {
      setRes(null);
      return;
    }

    setQuoting(true);
    try {
      setRes(await getTronQuote({
        originChain: String(origin),
        destinationChain: 'tron',
        sellToken: token.address,
        buyToken: TRON_USDT,
        sellAmount: raw,
        originAddress: wallet.address,
        /*
         * The server needs these to compute the loss percentage. Without them
         * it assumed 6 decimals on both sides and reported "you lose 100%" for
         * a perfectly good BNB Chain quote, where USDC carries 18. Measured
         * against production before this was added.
         */
        sellDecimals: String(token.decimals),
        buyDecimals: '6',
        /*
         * REQUIRED across a family boundary. 0x default the destination to the
         * origin address, which on Tron is an address nobody holds the key to
         * — a successful bridge straight into a burn. The server refuses
         * without it; sending it explicitly is the safe half of that contract.
         */
        destinationAddress: dest.trim()
      }));
    } catch (e) {
      setRes(null);
      setErr(e.code || 'QUOTE_FAILED');
    } finally {
      setQuoting(false);
    }
  }, [wallet.isConnected, wallet.address, origin, token, amount, dest, destValid]);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fetchQuote, DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [fetchQuote]);

  const send = async () => {
    if (!summary?.tx) return;
    setBusy(true);
    setTxErr(null);
    haptic?.('medium');
    try {
      if (wallet.chainId !== origin) await wallet.switchChain?.(origin);
      const signer = wallet.getSigner?.();
      if (!signer) throw new Error('NO_SIGNER');

      /*
       * Approve the bridge's spender for this amount only, never infinite.
       * The target comes from the quote rather than being hard-coded: it
       * differs per chain, and a wrong spender fails at signing with an opaque
       * revert rather than a useful error.
       */
      const raw = toBaseUnits(amount, token.decimals);
      const { Contract } = await import('ethers');
      const { ERC20_ABI } = await import('../lib/chains');
      const erc20 = new Contract(token.address, ERC20_ABI, signer);
      const spender = summary.allowanceTarget;
      if (spender) {
        const need = BigInt(raw);
        const current = await erc20.allowance(wallet.address, spender);
        if (current < need) {
          /* Some ERC-20s reject non-zero → non-zero; zero it out first. */
          if (current > 0n) await (await erc20.approve(spender, 0n)).wait();
          await (await erc20.approve(spender, need)).wait();
        }
      }

      const sent = await signer.sendTransaction({
        to: summary.tx.to,
        data: summary.tx.data,
        value: summary.tx.value ?? undefined
      });
      setTxHash(sent.hash);
      haptic?.('success');
    } catch (e) {
      setTxErr(e?.shortMessage || e?.message || 'TX_FAILED');
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="card">
        <div className="field-label">{t('tron.from')}</div>
        <select
          className="brg-select"
          style={{ width: '100%' }}
          value={origin}
          onChange={(e) => { setOrigin(Number(e.target.value)); setRes(null); }}
        >
          {TRON_ORIGINS.map((c) => (
            <option key={c.id} value={c.id}>{c.name} · USDC</option>
          ))}
        </select>

        <input
          className="brg-amount"
          type="number"
          inputMode="decimal"
          min="0"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        {/*
          ─── THE WARNING THAT MATTERS MOST ────────────────────────────────
          A flat cost is invisible as a percentage until the amount is small.
          $10 loses 17%; $1,000 loses 0.48%. This is shown BEFORE the quote
          arrives, because the user should not have to wait to be told their
          transfer is a bad idea. It does not block — someone may have a
          reason — but it cannot be missed.
        */}
        {amountWarn?.tooSmall && (
          <p className="notice notice-danger" style={{ marginTop: 10 }}>
            {t('tron.tooSmall', { min: amountWarn.minUsd })}
          </p>
        )}

        <div className="field-label" style={{ marginTop: 12 }}>{t('tron.to')}</div>
        <input
          type="text"
          value={dest}
          onChange={(e) => setDest(e.target.value)}
          placeholder="T…"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          style={{ direction: 'ltr', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 12 }}
        />
        {dest !== '' && !destValid && (
          <p className="notice notice-danger" style={{ marginTop: 8 }}>{t('tron.badAddress')}</p>
        )}

        {quoting && <p className="faint" style={{ marginTop: 10 }}>{t('bridge.quoting')}</p>}
        {err && !quoting && (
          <p className="notice notice-danger" style={{ marginTop: 10 }}>
            {t(`bridge.err.${err}`, { defaultValue: t('bridge.err.QUOTE_FAILED') })}
          </p>
        )}

        {summary && !quoting && (
          <div className="brg-quote">
            <div className="row-between">
              <span className="faint">{t('bridge.youReceive')}</span>
              <span className="mono brg-out">{fmtQty(Number(summary.buyAmount) / 1e6)} USDT</span>
            </div>
            <div className="row-between">
              <span className="faint">{t('bridge.ourFee')}</span>
              <span className="mono" style={{ fontSize: 12 }}>{fmtQty(summary.ourFee)} USDC</span>
            </div>
            {/*
              The total loss as a percentage — the only honest way to show a
              flat cost. Raw numbers look fine in isolation; a user comparing
              "10" with "8.29" afterwards is a user we quietly hurt.
            */}
            {summary.lossPercent != null && (
              <div className="row-between">
                <span className="faint">{t('tron.totalLoss')}</span>
                <span className={`mono ${summary.severeLoss ? 'down' : ''}`} style={{ fontSize: 12 }}>
                  {summary.lossPercent}%
                </span>
              </div>
            )}
            {summary.etaSeconds != null && (
              <div className="row-between">
                <span className="faint">{t('bridge.eta')}</span>
                <span className="mono" style={{ fontSize: 12 }}>~{summary.etaSeconds}s</span>
              </div>
            )}
          </div>
        )}

        {summary?.severeLoss && (
          <p className="notice notice-danger" style={{ marginTop: 10 }}>
            {t('tron.severeLoss', { pct: summary.lossPercent })}
          </p>
        )}

        {!wallet.isConnected ? (
          <p className="notice" style={{ marginTop: 12 }}>{t('bridge.connectFirst')}</p>
        ) : (
          <button
            className="btn btn-primary"
            style={{ marginTop: 12, width: '100%' }}
            disabled={!summary?.tx || busy || !destValid}
            onClick={send}
          >
            {busy ? t('bridge.sending') : t('bridge.send')}
          </button>
        )}

        {txErr && <p className="notice notice-danger" style={{ marginTop: 10 }}>{txErr}</p>}
        {txHash && (
          <div className="notice" style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('bridge.sentTitle')}</div>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7 }}>{t('tron.sentBody')}</p>
          </div>
        )}
      </section>

      <InfoBox title={t('tron.whyTitle')} tone="info" id="tron-why">
        <p>{t('tron.whyBody')}</p>
      </InfoBox>
    </>
  );
}
