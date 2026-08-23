import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import qrcode from 'qrcode-generator';
import { useWallet } from '../context/WalletContext';
import { useAppStore } from '../store/useAppStore';
import { btcAddressForSigner } from '../lib/btcWallet';
import { getBtcAddressInfo, getBtcFees } from '../lib/btcApi';
import { getThorQuote, toThorUnits } from '../lib/thorswap';
import { DUST_SATS } from '../lib/btcTx';
import { fmtQty, fmtUsd, fmtNum } from '../lib/format';
import { usePriceMap } from '../hooks/useMarket';
import useHideBalances from '../hooks/useHideBalances';
import { IconCopy, IconCheck } from './Icons';
import BtcSendSheet from './BtcSendSheet';

/**
 * THE BITCOIN CARD — the internal wallet's face on the Wallet page.
 * ---------------------------------------------------------------------------
 * This is the piece that closes the P2P funnel: the BTC bought for rial on
 * the market tab now has somewhere in-app to land (m/84'/0'/0'/0/0 of the
 * SAME seed — see lib/btcWallet.js), and the balance shown here has a
 * "convert to BTCB" button that swaps it into the EVM leg without ever
 * leaving the app. Previously both steps happened in TrustWallet, which is
 * where our 0.70% swap revenue went to die.
 *
 * ANTI-CANNIBALIZATION, PRESERVED BY CONSTRUCTION: this card is reachable
 * only from the Wallet page, and the convert lane is for money that is
 * ALREADY bitcoin sitting in this wallet — a "local input" lane, exactly
 * like the Bridge's native tab. It is never a quote source, never an
 * alternative to the swap path for crypto-to-crypto users, and the wiring
 * suite hard-fails any attempt to wire it in.
 *
 * The card renders ONLY for the unlocked local vault: an injected wallet
 * cannot grow a bitcoin leg (zero law), and a locked vault has no phrase in
 * memory to derive from.
 */
export default function BtcCard() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const notify = useAppStore((st) => st.notify);
  const { priceMap } = usePriceMap(100);
  const hideBalances = useHideBalances();

  /* Sats are a balance like any other: exact digits, but masked by the same
     switch that masks the BTC line above (fmtQty) — one switch, all numbers. */
  const sats = (v) => (hideBalances ? '••••' : fmtNum(v, 0));

  const [address, setAddress] = useState(null);
  const [info, setInfo] = useState(null); /* { confirmedSats, unconfirmedSats } */
  const [fees, setFees] = useState(null);
  const [copied, setCopied] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendPrefill, setSendPrefill] = useState(null);
  const [convertBusy, setConvertBusy] = useState(false);
  const [convertError, setConvertError] = useState(null);

  const unlocked = wallet?.mode === 'local' && !wallet?.locked && Boolean(wallet?.address);

  /* The BTC address of THIS vault, index 0 (the default Receive address).
     btcAddressForSigner refuses injected wallets and locked vaults, so the
     card simply has nothing to show for them — no partial state. */
  useEffect(() => {
    if (!unlocked) { setAddress(null); setInfo(null); return undefined; }
    let alive = true;
    (async () => {
      const addr = await btcAddressForSigner(wallet.getSigner?.(), { index: 0 });
      if (alive) setAddress(addr);
    })();
    return () => { alive = false; };
  }, [unlocked, wallet?.address]);

  /* Balance — the NFT-chip effect pattern: refetch when the address settles,
     never hammer the proxy on rerenders. */
  useEffect(() => {
    if (!address) return undefined;
    let alive = true;
    (async () => {
      try {
        const [addrInfo, feeTable] = await Promise.all([getBtcAddressInfo(address), getBtcFees()]);
        if (!alive) return;
        setInfo({
          confirmedSats: Number(addrInfo?.confirmedSats ?? 0),
          unconfirmedSats: Number(addrInfo?.unconfirmedSats ?? 0)
        });
        setFees(feeTable?.satPerVb ?? null);
      } catch {
        if (alive) setInfo({ confirmedSats: 0, unconfirmedSats: 0, failed: true });
      }
    })();
    return () => { alive = false; };
  }, [address]);

  const btcPrice = priceMap?.bitcoin ?? null;
  const confirmed = info?.confirmedSats ?? 0;
  const fiatValue = btcPrice != null ? (confirmed / 1e8) * btcPrice : null;

  /* THE FUNNEL: real, confirmed, above-dust bitcoin gets one honest next
     step — BTC → BTCB on BSC through THORChain, destination = this same
     wallet's EVM address. The memo is built server-side by the THOR lane and
     rides the transaction as an OP_RETURN built by btcTx. */
  const convertible = confirmed > DUST_SATS;

  const convert = async () => {
    if (convertBusy || !convertible) return;
    setConvertBusy(true);
    setConvertError(null);
    try {
      /* Reserve a normal-fee budget so the sweep tx can pay its own fee;
         THORChain needs the memo, not a rounding remainder. */
      const feeReserve = Math.ceil(251 * Number(fees?.normal ?? 12));
      const amountBtc = Math.max(0, (confirmed - feeReserve) / 1e8);
      const amount = toThorUnits(amountBtc.toFixed(8));
      if (!amount || Number(amount) <= 0) throw new Error('AMOUNT_TOO_SMALL');
      const quote = await getThorQuote({
        from: 'BTC.BTC',
        to: 'BSC.BTCB-1DE',
        amount,
        destination: wallet.address
      });
      if (!quote?.inbound_address || !quote?.memo) throw new Error('QUOTE_INCOMPLETE');
      setSendPrefill({
        recipient: String(quote.inbound_address).trim(),
        memo: String(quote.memo).trim(),
        thor: { out: fromThorUnitsSafe(quote.expected_amount_out), dest: wallet.address }
      });
      setSendOpen(true);
    } catch (err) {
      setConvertError(err?.message || 'QUOTE_FAILED');
    } finally {
      setConvertBusy(false);
    }
  };

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      notify('addressCopied', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify('copyFailed', 'error');
    }
  };

  /* QR path — same encoder and construction as ReceiveSheet: SVG, crispEdges,
     currentColor-agnostic (explicit #000 on the quiet-zone white). */
  const qrPath = useMemo(() => {
    if (!address) return null;
    try {
      const q = qrcode(0, 'M');
      q.addData(address);
      q.make();
      const count = q.getModuleCount();
      let d = '';
      for (let r = 0; r < count; r += 1) {
        for (let c = 0; c < count; c += 1) {
          if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
        }
      }
      return { d, count };
    } catch {
      return null;
    }
  }, [address]);

  if (!unlocked) return null;

  return (
    <section className="card" style={{ marginTop: 12, padding: '14px 14px' }} aria-label={t('btc.card.title')}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 800 }}>{t('btc.card.title')}</div>
          <div className="faint" style={{ fontSize: 10.5, marginTop: 2 }}>{t('btc.card.subtitle')}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="mono" style={{ fontSize: 15, fontWeight: 800 }}>
            {info ? `${fmtQty(confirmed / 1e8)} BTC` : '…'}
          </div>
          <div className="faint mono" style={{ fontSize: 10.5 }}>
            {info ? `${sats(confirmed)} sats` : ''}
          </div>
          {fiatValue != null ? (
            <div className="faint" style={{ fontSize: 10.5 }}>{fmtUsd(fiatValue)}</div>
          ) : null}
        </div>
      </div>

      {info?.unconfirmedSats > 0 ? (
        <p className="notice" style={{ margin: '10px 0 0', fontSize: 11 }}>
          {t('btc.card.incoming', { sats: sats(info.unconfirmedSats) })}
        </p>
      ) : null}

      <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'center' }}>
        {qrPath && (
          <div style={{
            flexShrink: 0, width: 64, height: 64, padding: 4, background: '#fff', borderRadius: 10
          }}>
            <svg viewBox={`0 0 ${qrPath.count} ${qrPath.count}`} width="100%" height="100%" shapeRendering="crispEdges" role="img" aria-label={t('btc.card.title')}>
              <path d={qrPath.d} fill="#000" />
            </svg>
          </div>
        )}
        <div className="mono" dir="ltr" style={{ flex: 1, fontSize: 10.5, wordBreak: 'break-all', lineHeight: 1.7 }}>
          {(address ?? '').match(/.{1,4}/g)?.join(' ')}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" style={{ borderRadius: 12 }} onClick={copy} aria-label={t('btc.card.copy')}>
          {copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
        </button>
      </div>

      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ flex: 1, minHeight: 44, borderRadius: 13 }}
          disabled={confirmed <= 0}
          onClick={() => { setSendPrefill(null); setSendOpen(true); }}
        >
          {t('btc.card.send')}
        </button>
        {convertible ? (
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1.3, minHeight: 44, borderRadius: 13 }}
            disabled={convertBusy}
            onClick={convert}
          >
            {convertBusy ? t('btc.card.converting') : t('btc.card.convert')}
          </button>
        ) : null}
      </div>

      {convertError ? (
        <p className="notice notice-danger" role="alert" style={{ margin: '10px 0 0', fontSize: 11.5 }}>
          {t(`btc.card.err.${convertError}`, { defaultValue: t('btc.card.err.QUOTE_FAILED') })}
        </p>
      ) : null}

      {convertible ? (
        <p className="faint" style={{ margin: '8px 0 0', fontSize: 10.5, lineHeight: 1.7 }}>
          {t('btc.card.convertNote')}
        </p>
      ) : (
        <p className="faint" style={{ margin: '8px 0 0', fontSize: 10.5, lineHeight: 1.7 }}>
          {t('btc.card.note')}
        </p>
      )}

      <BtcSendSheet
        open={sendOpen}
        onClose={() => { setSendOpen(false); setSendPrefill(null); setConvertError(null); }}
        prefill={sendPrefill}
      />
    </section>
  );
}

function fromThorUnitsSafe(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n / 1e8 : null;
}
