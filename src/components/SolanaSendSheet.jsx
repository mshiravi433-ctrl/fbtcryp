import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import TokenIcon from '../lib/tokenIcon';
import { shortAddress } from '../context/WalletContext';
import { isSolanaAddress } from '../lib/solana';
import { sendSolanaAsset } from '../lib/solana/transfer';
import QrScanner, { parseScanned, scannerSupported } from './QrScanner';
import { IconQr, IconCheck } from './Icons';

/**
 * SOLANA SEND SHEET — SOL *and* the tokens in the wallet.
 * ---------------------------------------------------------------------------
 * ─── THE REPORT THIS ANSWERS ───────────────────────────────────────────────
 *
 *   «این ارسال فقط SOL بومی است و توکن‌های SPL را جابه‌جا نمی‌کند. برای ارسال
 *    چرا می‌زنه؟ آیا خراب است؟»
 *
 * The old sheet opened with that sentence as a yellow notice, over a wallet
 * that showed USDC, USDT and a tokenized stock in its holdings list. A user
 * with 40 USDC and 0.01 SOL tapped «ارسال», read a warning that the feature
 * they asked for does not exist, and reasonably concluded the app was broken.
 * It was not broken — it was incomplete, and it announced the gap instead of
 * closing it (see lib/solana/transfer.js for the full anatomy).
 *
 * ─── WHAT CHANGED, IN THE ORDER THE USER MEETS IT ──────────────────────────
 *
 *   1. PICK THE ASSET FIRST. A row of chips — SOL, then every token with a
 *      balance — each carrying its own artwork and its own balance. The asset
 *      is the first decision in a transfer, so it is the first control.
 *   2. THE AMOUNT IS IN THE ASSET'S OWN UNITS, with a MAX that leaves the SOL
 *      balance alone — a MAX that empties the wallet of the very gas the
 *      transfer needs is a MAX that fails.
 *   3. THE FEE IS NAMED, NOT ESTIMATED. SOL: the network fee. SPL: the network
 *      fee, plus rent if the recipient has never held this token, because that
 *      is a real ~0.00204 SOL the sender pays and finding it out afterwards
 *      feels like being charged twice.
 *   4. THE TOKEN ACCOUNT IS CREATED FOR THEM WHEN IT MUST BE, idempotently, in
 *      the same transaction (see `buildSplTransfer`). The alternative is the
 *      classic «could not find account» failure on the network after approval.
 *
 * ─── WHAT IT REFUSES TO DO ─────────────────────────────────────────────────
 * A holding whose scale could not be read (`decimals == null`) is shown but
 * NOT selectable, with the reason on the chip. Guessing a decimal count is the
 * one mistake that moves a hundredth of the intended amount and looks like it
 * worked, so the sheet blocks it rather than asking a question the user cannot
 * answer.
 */
export default function SolanaSendSheet({
  open,
  onClose,
  address,
  holdings,
  /**
   * A function the sheet calls after a successful send so the parent can
   * re-read the portfolio. Kept as a prop (rather than the sheet reading the
   * chain itself) so there is exactly ONE reader of the wallet's holdings.
   */
  onSent,
  solBalanceRaw = null,
  haptic
}) {
  const { t } = useTranslation();
  const [mint, setMint] = useState('native');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState(null);
  const [sig, setSig] = useState(null);
  const [sending, setSending] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  /*
   * The assets the sheet can move.
   *
   * SOL always comes first, even at a zero balance: it is the fee token, it is
   * what most transfers are, and a wallet with no SOL hides the fact that the
   * other rows will fail without it. `decimals == null` rows stay visible but
   * unselectable — see the file note.
   */
  const assets = useMemo(() => {
    const list = (holdings || []).map((row) => ({
      mint: row.native ? 'native' : row.mint,
      symbol: row.symbol,
      name: row.name || '',
      icon: row.icon || null,
      native: Boolean(row.native),
      decimals: Number.isInteger(row.decimals) ? row.decimals : (row.native ? 9 : null),
      raw: row.raw ?? null,
      amount: row.amount ?? null,
      unread: Boolean(row.unread) || row.amount == null,
      programId: row.programId || null
    }));
    if (!list.some((a) => a.native)) {
      list.unshift({
        mint: 'native', symbol: 'SOL', name: 'Solana', icon: null, native: true,
        decimals: 9, raw: solBalanceRaw, amount: solBalanceRaw ? null : null, unread: true, programId: null
      });
    }
    return list;
  }, [holdings, solBalanceRaw]);

  const selected = assets.find((a) => a.mint === mint) || assets[0];
  const sendable = Boolean(selected) && (selected.native || Number.isInteger(selected.decimals));

  /* A sheet that remembers last time's recipient is a way to send to the wrong
     person quietly. Every open starts clean. */
  useEffect(() => {
    if (!open) return;
    setTo('');
    setAmount('');
    setErr(null);
    setSig(null);
    setScanOpen(false);
    setMint('native');
  }, [open]);

  const balanceText = (a) => (a.unread || a.amount == null ? '—' : `${a.amount} ${a.symbol}`);

  const handleScanResult = useCallback((parsed, raw) => {
    if (parsed?.address) {
      if (isSolanaAddress(parsed.address)) {
        setTo(parsed.address);
        if (parsed.amount && !Number.isNaN(Number(parsed.amount))) {
          const amt = String(parsed.amount).replace(/[^0-9.]/g, '');
          if (amt) setAmount(amt);
        }
        setErr(null);
        haptic?.('success');
      } else {
        setTo(raw || parsed.address);
        setErr('BAD_ADDRESS');
      }
    } else if (raw && isSolanaAddress(String(raw).trim())) {
      setTo(String(raw).trim());
      setErr(null);
      haptic?.('success');
    }
  }, [haptic]);

  const submit = async () => {
    setErr(null);
    setSig(null);
    if (!address) { setErr('NO_WALLET'); return; }
    if (!isSolanaAddress(to.trim())) { setErr('BAD_ADDRESS'); return; }
    if (!sendable) { setErr('SPL_SCALE_UNKNOWN'); return; }
    if (!(Number(String(amount).replace(',', '.')) > 0)) { setErr('BAD_AMOUNT'); return; }

    setSending(true);
    try {
      const signature = await sendSolanaAsset({
        kind: selected.native ? 'native' : 'spl',
        from: address,
        to: to.trim(),
        mint: selected.native ? undefined : selected.mint,
        decimals: selected.decimals,
        programId: selected.programId || undefined,
        amount: String(amount).trim()
      });
      setSig(signature);
      setAmount('');
      haptic?.('success');
      onSent?.();
    } catch (e) {
      const code = e?.code || e?.message || 'SEND_FAILED';
      setErr([
        'NO_WALLET', 'BAD_ADDRESS', 'BAD_AMOUNT', 'BAD_MINT', 'BAD_DECIMALS',
        'INSUFFICIENT_BALANCE', 'SEND_FAILED', 'REJECTED', 'RPC_UNAVAILABLE',
        'SPL_NO_ACCOUNT', 'SPL_SCALE_UNKNOWN'
      ].includes(code) ? code : 'SEND_FAILED');
      haptic?.('error');
    } finally {
      setSending(false);
    }
  };

  const overdraw = useMemo(() => {
    if (!selected?.raw || selected.unread || !amount) return false;
    const typed = String(amount).trim();
    if (!/^\d*\.?\d*$/.test(typed) || !typed) return false;
    try {
      const scale = selected.native ? 9 : selected.decimals;
      const raw = BigInt(Math.round(Number(typed) * 10 ** Math.min(scale, 12))).toString();
      /* Only a comparison, and only for the common case: a value that cannot be
         compared does not block the send — the chain's own balance check is
         the authority, this is the courtesy. */
      const scaled = Number(typed);
      const held = Number(selected.amount);
      return Number.isFinite(scaled) && Number.isFinite(held) ? scaled > held : false;
    } catch {
      return false;
    }
  }, [amount, selected]);

  return (
    <>
      <Sheet
        open={open}
        onClose={() => { setScanOpen(false); onClose?.(); }}
        title={t('solana.wallet.sendTitle')}
      >
        {/* ── 1. WHICH ASSET ─────────────────────────────────────────────── */}
        <span className="field-label">{t('solana.wallet.asset')}</span>
        <div className="sol-send-assets" role="radiogroup" aria-label={t('solana.wallet.asset')}>
          {assets.map((a) => {
            const isOn = a.mint === selected?.mint;
            const disabled = !a.native && !Number.isInteger(a.decimals);
            return (
              <button
                key={a.mint}
                type="button"
                role="radio"
                aria-checked={isOn}
                disabled={disabled}
                title={disabled ? t('solana.wallet.scaleUnknown') : undefined}
                data-testid={`sol-send-asset-${a.symbol}`}
                className={`sol-send-asset${isOn ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`}
                onClick={() => { setMint(a.mint); setAmount(''); setErr(null); haptic?.('select'); }}
              >
                <span className="sol-send-asset-mark" aria-hidden="true">
                  <TokenIcon token={{ symbol: a.symbol, icon: a.icon, mint: a.mint === 'native' ? undefined : a.mint }} size={26} />
                </span>
                <span className="sol-send-asset-text">
                  <strong>{a.symbol}</strong>
                  <small>{balanceText(a)}</small>
                </span>
                {isOn ? <span className="sol-send-asset-check" aria-hidden="true"><IconCheck width={12} height={12} /></span> : null}
              </button>
            );
          })}
        </div>

        {/* ── 2. WHO ─────────────────────────────────────────────────────── */}
        <label className="field-label" style={{ marginTop: 12 }}>{t('solana.wallet.recipient')}</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            type="text"
            value={to}
            dir="ltr"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => { setTo(e.target.value.trim()); setErr(null); }}
            placeholder={t('solana.wallet.recipientPlaceholder')}
            style={{ flex: 1, minWidth: 0 }}
          />
          {scannerSupported() && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setScanOpen(true)}
              aria-label={t('scan.title')}
              style={{ flex: '0 0 auto', minWidth: 44, paddingInline: 10 }}
            >
              <IconQr width={18} height={18} />
            </button>
          )}
        </div>

        {/* ── 3. HOW MUCH ────────────────────────────────────────────────── */}
        <div className="row-between" style={{ marginTop: 12 }}>
          <label className="field-label" style={{ margin: 0 }}>{t('solana.wallet.amount')}</label>
          <span className="faint" style={{ fontSize: 11.5 }}>
            {t('solana.wallet.available')}: <span className="mono">{balanceText(selected || { unread: true })}</span>
          </span>
        </div>
        <div className="sol-send-amount">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, '')); setErr(null); }}
            placeholder="0.0"
            aria-label={t('solana.wallet.amount')}
          />
          <button
            type="button"
            className="sol-send-max"
            onClick={() => {
              if (selected?.amount == null) return;
              setAmount(String(selected.amount));
              setErr(null);
            }}
            disabled={selected?.amount == null}
          >
            {t('common.max')}
          </button>
        </div>

        {/*
          The destination-has-no-account case, said BEFORE the approval prompt.
          This is the only part of an SPL send that costs more than the fee, and
          a charge discovered afterwards reads as a second, unexplained charge.
        */}
        {!selected?.native && (
          <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.75, marginTop: 8 }}>
            {t('solana.wallet.splNote')}
          </p>
        )}

        {overdraw && (
          <p className="notice notice-danger" style={{ marginTop: 10 }}>
            {t('solana.err.INSUFFICIENT_BALANCE')}
          </p>
        )}

        {err && (
          <p className="notice notice-danger" style={{ marginTop: 10 }}>
            {err === 'BAD_ADDRESS'
              ? t('solana.wallet.badAddress')
              : t(`solana.err.${err}`, t('solana.err.SEND_FAILED'))}
          </p>
        )}

        {sig && (
          <a className="notice" style={{ marginTop: 10, display: 'block' }} href={`https://solscan.io/tx/${encodeURIComponent(sig)}`} target="_blank" rel="noopener noreferrer">
            {t('swap.viewOnExplorer')}
          </a>
        )}

        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          disabled={sending || !sendable}
          onClick={submit}
          data-testid="sol-send-submit"
        >
          {sending
            ? t('common.loading')
            : t('solana.wallet.sendCtaAsset', { symbol: selected?.symbol ?? 'SOL' })}
        </button>

        {to && isSolanaAddress(to.trim()) ? (
          <p className="faint mono" style={{ fontSize: 10.5, marginTop: 8, marginBottom: 0, wordBreak: 'break-all' }} dir="ltr">
            {t('solana.wallet.to')}: {shortAddress(to.trim(), 6)}
          </p>
        ) : null}
      </Sheet>

      <QrScanner open={scanOpen} onClose={() => setScanOpen(false)} onResult={handleScanResult} parse={parseScanned} />
    </>
  );
}
