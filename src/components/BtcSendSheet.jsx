import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Sheet from './Sheet';
import { useWallet } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { useAppStore } from '../store/useAppStore';
import { btcAddressInfo } from '../lib/btcAddress';
import { btcAddressForSigner, btcSpendFromSigner } from '../lib/btcWallet';
import { buildP2wpkhTx, DUST_SATS } from '../lib/btcTx';
import { getBtcAddressInfo, getBtcFees, broadcastBtcTx } from '../lib/btcApi';
import { IconCheck, IconExternal, IconShield } from './Icons';
import { fmtNum } from '../lib/format';
import useHideBalances from '../hooks/useHideBalances';

/**
 * BITCOIN SEND — the P2WPKH leg of the internal wallet.
 * ---------------------------------------------------------------------------
 * Built on SendSheet's rules because the failure modes are the same ones:
 *
 * 1. The address passes the REAL mainnet checksum (lib/btcAddress.js) before
 *    anything else happens — not a regex, and not testnet-tolerant.
 * 2. The confirm step shows the address chunked and the amount in both BTC
 *    and integer satoshis, with an irreversibility warning in plain words.
 *    Bitcoin has no firewall, no revert, no support desk.
 * 3. Selection policy is ALL UTXOs (lib/btcTx.js) — no clever coin
 *    selection, so no change-to-the-wrong-address class of bug.
 * 4. The private key exists for the duration of ONE signing call and is
 *    never in state, storage or a log (the zero law, enforced by
 *    btcSpendFromSigner returning only what this sheet immediately uses).
 *
 * THE FUNNEL MODE: `prefill` (from the Wallet card's "convert to BTCB")
 * arrives with a THORChain deposit — recipient = the quote's inbound
 * address, memo = the quote's memo string (carried verbatim in an
 * OP_RETURN output built by btcTx). The done step then hands off to the
 * existing BTCB swap, closing the loop INSIDE the app instead of in
 * TrustWallet.
 */

const BTC = 100_000_000; /* sats — integer, the only unit the wire speaks */

/** Human BTC amount -> integer sats; null when the input is not money. */
function btcToSats(text) {
  const s = String(text ?? '').trim().replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,8})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const padded = (frac + '0'.repeat(8)).slice(0, 8);
  return Number(whole) * BTC + Number(padded);
}

export default function BtcSendSheet({ open, onClose, prefill = null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const notify = useAppStore((st) => st.notify);
  const { haptic } = useTelegram();
  const hideBalances = useHideBalances();
  const sats = (v) => (hideBalances ? '••••' : fmtNum(v, 0));

  const [stage, setStage] = useState('form'); /* form → confirm → sending → done */
  const [recipient, setRecipient] = useState('');
  const [amountBtc, setAmountBtc] = useState('');
  const [memo, setMemo] = useState('');
  const [feeMode, setFeeMode] = useState('normal');
  const [fees, setFees] = useState(null);
  const [balance, setBalance] = useState(null); /* { confirmedSats, utxos } */
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); /* { code, detail } */
  const [result, setResult] = useState(null); /* { txid, feeSats, vsize } */

  /* Reset on every open — a stale amount surviving between opens is exactly
     the "sent the previous number" bug SendSheet guards against. */
  useEffect(() => {
    if (!open) return undefined;
    setStage('form');
    setRecipient(prefill?.recipient ?? '');
    setAmountBtc('');
    setMemo(prefill?.memo ?? '');
    setFeeMode('normal');
    setError(null);
    setResult(null);
    setBusy(false);
    return undefined;
  }, [open, prefill]);

  const recipientInfo = useMemo(() => (recipient ? btcAddressInfo(recipient) : null), [recipient]);
  const amountSats = useMemo(() => btcToSats(amountBtc), [amountBtc]);

  const unlocked = wallet?.mode === 'local' && !wallet?.locked && Boolean(wallet?.address);

  /* Balance + fees while the sheet is open (the UTXO set is what we spend).
     Our own BTC address comes from the unlocked vault — never an input. */
  useEffect(() => {
    if (!open || !unlocked) return undefined;
    let alive = true;
    (async () => {
      try {
        const own = await btcAddressForSigner(wallet.getSigner?.(), { index: 0 });
        if (!own) throw Object.assign(new Error('LOCKED'), { code: 'LOCKED' });
        const [info, feeTable] = await Promise.all([getBtcAddressInfo(own), getBtcFees()]);
        if (!alive) return;
        setBalance({
          confirmedSats: Number(info?.confirmedSats ?? 0),
          utxos: Array.isArray(info?.utxos) ? info.utxos : []
        });
        setFees(feeTable?.satPerVb ?? null);
      } catch (err) {
        if (alive) setError({ code: err?.code || err?.message || 'LOAD_FAILED', detail: err?.detail ?? null });
      }
    })();
    return () => { alive = false; };
  }, [open, unlocked, wallet]);

  /* The fee in sats for the CURRENT shape, from the live vsize estimate the
     builder will use. Refreshed whenever the inputs change. */
  const feeSats = useMemo(() => {
    if (!fees || !balance || amountSats == null) return null;
    const rate = Number(fees[feeMode]);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    /* worst-case honest estimate: 2-in / 3-out ≈ 251 vB; the builder computes
       the exact weight and the real fee shows on the confirm step */
    const vsize = Math.max(110, 68 * Math.min(balance.utxos.length || 1, 8) + 31 * 2 + 22 + 11);
    return Math.ceil(vsize * rate);
  }, [fees, feeMode, balance, amountSats]);

  const spendable = balance ? Math.max(0, balance.confirmedSats - (feeSats ?? 0)) : 0;

  const setMax = () => {
    if (spendable <= 0) return;
    setAmountBtc((spendable / BTC).toFixed(8).replace(/0+$/, '').replace(/\.$/, ''));
  };

  const canSubmit = Boolean(
    stage === 'form' && recipientInfo?.valid && amountSats != null && amountSats >= DUST_SATS && busy === false
  );

  const submit = () => {
    setError(null);
    setStage('confirm');
    haptic?.('light');
  };

  const confirmSend = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStage('sending');
    try {
      const signer = wallet.getSigner?.();
      /* btcSpendFromSigner refuses anything that is not the unlocked local
         vault — the zero law's door. The key below lives only in this frame. */
      const spend = await btcSpendFromSigner(signer, { index: 0 });
      if (!spend) throw Object.assign(new Error('LOCKED'), { code: 'LOCKED' });

      const info = await getBtcAddressInfo(spend.address);
      const utxos = (Array.isArray(info?.utxos) ? info.utxos : []).map((u) => ({ txid: u.txid, vout: u.vout, value: u.value }));
      if (utxos.length === 0) throw Object.assign(new Error('NO_UTXOS'), { code: 'NO_UTXOS' });

      const rate = Number(fees?.[feeMode]);
      const built = await buildP2wpkhTx({
        utxos,
        payees: [{ address: recipient.trim(), valueSats: amountSats }],
        memo: memo ? String(memo) : null,
        changeAddress: spend.address,
        feeRateSatVb: rate,
        privateKey: spend.privateKey,
        pubkeyHash: spend.pubkeyHash
      });
      /* the key reference dies here with `spend` — nothing below needs it */

      const sent = await broadcastBtcTx(built.txHex);
      setResult({ txid: sent?.txid ?? built.txid, feeSats: built.feeSats, vsize: built.vsize });
      setStage('done');
      haptic?.('medium');
      notify('btcSent', 'success');
    } catch (err) {
      setError({ code: err?.message || 'SEND_FAILED', detail: err?.detail ?? null });
      setStage('form');
    } finally {
      setBusy(false);
    }
  };

  const chunked = (a) => (a.match(/.{1,4}/g) ?? []).join(' ');

  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose} title={t('btc.send.title')} anchor="bottom" size="lg">
      {!unlocked ? (
        <p className="notice">{t('btc.send.locked')}</p>
      ) : stage === 'done' && result ? (
        /* ------------------------------- done ------------------------------- */
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <IconCheck width={18} height={18} />
            <strong style={{ fontSize: 14 }}>{t('btc.send.doneTitle')}</strong>
          </div>
          <p className="prose-sm" style={{ margin: 0 }}>{t('btc.send.doneBody')}</p>
          {result.txid && (
            <div className="card card-tight mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>
              <a
                href={`https://mempool.space/tx/${result.txid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="row"
                style={{ gap: 6, alignItems: 'center' }}
              >
                {result.txid.slice(0, 32)}… <IconExternal width={12} height={12} />
              </a>
            </div>
          )}
          <p className="faint" style={{ fontSize: 11.5, margin: 0 }}>
            {t('btc.send.feePaid', { sats: sats(result.feeSats) })} · ~{fmtNum(result.vsize, 0)} vB
          </p>
          {prefill?.thor ? (
            <>
              <p className="notice" style={{ margin: 0 }}>{t('btc.send.thorArrival')}</p>
              <button
                className="btn btn-primary"
                style={{ minHeight: 48, borderRadius: 14 }}
                onClick={() => { onClose(); navigate('/swap?from=BTCB&to=USDT'); }}
              >
                {t('btc.send.swapBtcb')}
              </button>
            </>
          ) : null}
        </div>
      ) : stage === 'confirm' ? (
        /* ------------------------------ confirm ----------------------------- */
        <div className="stack" style={{ gap: 12 }}>
          <p className="notice" style={{ margin: 0, fontWeight: 700 }}>{t('btc.send.confirmTitle')}</p>

          <div className="card card-tight" style={{ borderColor: 'var(--line-strong)' }}>
            <div className="row-between" style={{ padding: '4px 0', fontSize: 12 }}>
              <span className="faint">{t('btc.send.amountLabel')}</span>
              <span className="mono" style={{ fontWeight: 800 }}>{amountBtc} BTC</span>
            </div>
            <div className="row-between" style={{ padding: '4px 0', fontSize: 11.5, borderTop: '1px solid var(--line)' }}>
              <span className="faint">{t('btc.send.satsLabel')}</span>
              <span className="mono">{sats(amountSats)}</span>
            </div>
            <div className="row-between" style={{ padding: '4px 0', fontSize: 11.5, borderTop: '1px solid var(--line)' }}>
              <span className="faint">{t('btc.send.feeLabel')}</span>
              <span className="mono">{feeSats != null ? `${sats(feeSats)} sats · ${t(`btc.send.fee.${feeMode}`)}` : '—'}</span>
            </div>
            {memo ? (
              <div className="row-between" style={{ padding: '4px 0', fontSize: 11.5, borderTop: '1px solid var(--line)' }}>
                <span className="faint">{t('btc.send.memoLabel')}</span>
                <span className="mono" style={{ maxWidth: '62%', wordBreak: 'break-all', textAlign: 'right' }}>{memo}</span>
              </div>
            ) : null}
          </div>

          <div>
            <div className="faint" style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>{t('btc.send.toAddress')}</div>
            {/* Chunked + LTR so an RTL layout cannot visually reorder bech32. */}
            <div dir="ltr" className="mono" style={{ fontSize: 12.5, wordBreak: 'break-all', lineHeight: 1.9 }}>{chunked(recipient.trim())}</div>
          </div>

          {prefill?.thor ? (
            <p className="notice" style={{ margin: 0, fontSize: 11.5 }}>{t('btc.send.thorNote')}</p>
          ) : null}

          <p className="notice notice-danger" style={{ margin: 0, display: 'flex', gap: 7, alignItems: 'flex-start' }}>
            <IconShield width={14} height={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{t('btc.send.irreversible')}</span>
          </p>

          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost" style={{ flex: 1, minHeight: 48, borderRadius: 14 }} disabled={busy} onClick={() => setStage('form')}>
              {t('btc.send.back')}
            </button>
            <button className="btn btn-primary" style={{ flex: 1.4, minHeight: 48, borderRadius: 14 }} disabled={busy} onClick={confirmSend}>
              {busy ? t('btc.send.sending') : t('btc.send.confirmCta')}
            </button>
          </div>
        </div>
      ) : (
        /* ------------------------------- form ------------------------------- */
        <div className="stack" style={{ gap: 10 }}>
          {prefill?.thor ? <p className="notice" style={{ margin: 0, fontSize: 11.5 }}>{t('btc.send.thorPrefill')}</p> : null}

          <label className="field-label" htmlFor="btc-send-addr">{t('btc.send.recipient')}</label>
          <input
            id="btc-send-addr"
            dir="ltr"
            autoComplete="off"
            spellCheck="false"
            disabled={Boolean(prefill?.recipient)}
            className={`mono ${recipientInfo ? (recipientInfo.valid ? 'p2pm-addr-ok' : 'p2pm-addr-bad') : ''}`}
            placeholder="bc1q…"
            aria-invalid={Boolean(recipientInfo && !recipientInfo.valid)}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value.trim())}
          />
          {recipient && !recipientInfo?.valid ? (
            <p className="p2pm-addr-msg p2pm-addr-bad" role="alert">{t('btc.send.badAddress')}</p>
          ) : null}

          <label className="field-label" htmlFor="btc-send-amt" style={{ marginTop: 6 }}>{t('btc.send.amount')}</label>
          <div className="row" style={{ gap: 8 }}>
            <input
              id="btc-send-amt"
              dir="ltr"
              inputMode="decimal"
              autoComplete="off"
              className="mono"
              placeholder="0.001"
              value={amountBtc}
              onChange={(e) => setAmountBtc(e.target.value.trim())}
            />
            <button type="button" className="btn btn-ghost btn-sm" style={{ borderRadius: 12 }} onClick={setMax}>
              {t('btc.send.max')}
            </button>
          </div>
          <div className="row-between faint" style={{ fontSize: 11.5 }}>
            <span>
              {amountSats != null ? `${sats(amountSats)} sats` : ''}
              {amountSats != null && amountSats < DUST_SATS ? ` · ${t('btc.send.belowDust')}` : ''}
            </span>
            <span>{balance ? `${t('btc.send.balance')}: ${sats(balance.confirmedSats)} sats` : '…'}</span>
          </div>

          <label className="field-label" style={{ marginTop: 6 }}>{t('btc.send.feeTitle')}</label>
          <div className="row" style={{ gap: 6 }}>
            {['fast', 'normal', 'slow'].map((k) => (
              <button
                key={k}
                type="button"
                className={`btn btn-sm ${feeMode === k ? 'btn-primary' : 'btn-ghost'}`}
                style={{ flex: 1, minHeight: 40, borderRadius: 12 }}
                onClick={() => setFeeMode(k)}
              >
                {t(`btc.send.fee.${k}`)}
                {fees?.[k] ? <span className="faint" style={{ marginLeft: 5, fontSize: 10 }}>{fees[k]} sat/vB</span> : null}
              </button>
            ))}
          </div>

          {memo ? (
            <>
              <label className="field-label" style={{ marginTop: 6 }}>{t('btc.send.memoLabel')}</label>
              <div className="card card-tight mono" dir="ltr" style={{ fontSize: 11, wordBreak: 'break-all' }}>{memo}</div>
            </>
          ) : null}

          {error ? (
            <p className="notice notice-danger" role="alert" style={{ margin: 0 }}>
              {t(`btc.send.err.${error.code}`, { defaultValue: t('btc.send.err.SEND_FAILED') })}
              {error.detail ? <span className="faint" style={{ display: 'block', fontSize: 10.5 }}>{error.detail}</span> : null}
            </p>
          ) : null}

          <button className="btn btn-primary" style={{ minHeight: 50, borderRadius: 14, marginTop: 4 }} disabled={!canSubmit} onClick={submit}>
            {t('btc.send.reviewCta')}
          </button>
        </div>
      )}
    </Sheet>
  );
}
