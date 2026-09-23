import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import qrcode from 'qrcode-generator';
import Sheet from './Sheet';
import TokenIcon from '../lib/tokenIcon';
import { shortAddress } from '../context/WalletContext';
import { isSolanaAddress } from '../lib/solana';
import { readSolanaPortfolio } from '../lib/solana/portfolio';
import { sendNativeSol, solToLamports } from '../lib/solana/transfer';
import QrScanner, { parseScanned, scannerSupported } from './QrScanner';
import { IconQr } from './Icons';
import { IconSend, IconReceive } from './WalletArt';
import { IconSwap, IconGlobe } from './Icons';

function qrPath(text) {
  if (!text) return null;
  try {
    const q = qrcode(0, 'M');
    q.addData(text);
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
}

/** HashRouter reads `location.hash`. A hook would throw in tests that mount this tab without a Router. */
function openAppPath(path) {
  if (typeof window === 'undefined') return;
  const hash = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (window.location.hash !== hash) window.location.hash = hash;
}

function Action({ label, onClick, testId, action, Icon }) {
  return (
    <button type="button" className="sol-wal-action" data-action={action} onClick={onClick} data-testid={testId}>
      <span className="sol-wal-action-icon" aria-hidden="true">{Icon ? <Icon width={18} height={18} /> : null}</span>
      <span>{label}</span>
    </button>
  );
}

export default function SolanaWalletHome({
  address,
  walletName,
  balance,
  balanceLoading,
  balanceFailed,
  onConnect,
  onDisconnect,
  haptic
}) {
  const { t } = useTranslation();
  const [holdings, setHoldings] = useState(null);
  const [holdingsCode, setHoldingsCode] = useState(null);
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [sendErr, setSendErr] = useState(null);
  const [sendSig, setSendSig] = useState(null);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) {
      setHoldings(null);
      setHoldingsCode(null);
      setPartial(false);
      return;
    }
    setLoading(true);
    try {
      const res = await readSolanaPortfolio(address);
      if (!res.ok) {
        setHoldings(null);
        setHoldingsCode(res.code || 'RPC_UNAVAILABLE');
        setPartial(false);
        return;
      }
      setHoldings(res.holdings);
      setHoldingsCode(null);
      setPartial(Boolean(res.partial));
    } catch {
      setHoldings(null);
      setHoldingsCode('RPC_UNAVAILABLE');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const qr = useMemo(() => qrPath(address), [address]);
  const solRow = holdings?.find((row) => row.native);

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      haptic?.('success');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const handleScanResult = useCallback((parsed, raw) => {
    if (parsed?.address) {
      if (isSolanaAddress(parsed.address)) {
        setTo(parsed.address);
        if (parsed.amount && !Number.isNaN(Number(parsed.amount))) {
          // amount from QR may be in SOL; keep as string
          const amt = String(parsed.amount).replace(/[^0-9.]/g, '');
          if (amt) setAmount(amt);
        }
        setSendErr(null);
        haptic?.('success');
      } else {
        // EVM address scanned while solana sheet open — show raw but mark error
        setTo(raw || parsed.address);
        setSendErr('BAD_ADDRESS');
      }
    } else if (raw && isSolanaAddress(String(raw).trim())) {
      setTo(String(raw).trim());
      setSendErr(null);
      haptic?.('success');
    }
  }, [haptic]);

  const submitSend = async () => {
    setSendErr(null);
    setSendSig(null);
    if (!address) {
      setSendErr('NO_WALLET');
      return;
    }
    if (!isSolanaAddress(to.trim())) {
      setSendErr('BAD_ADDRESS');
      return;
    }
    const lamports = solToLamports(amount);
    if (!lamports) {
      setSendErr('BAD_AMOUNT');
      return;
    }
    if (solRow && !solRow.unread && solRow.raw && lamports > BigInt(solRow.raw)) {
      setSendErr('INSUFFICIENT_BALANCE');
      return;
    }
    setSending(true);
    try {
      const sig = await sendNativeSol({ from: address, to: to.trim(), lamports });
      setSendSig(sig);
      setAmount('');
      haptic?.('success');
      refresh();
    } catch (err) {
      const code = err?.code || err?.message || 'SEND_FAILED';
      setSendErr(['NO_WALLET', 'BAD_AMOUNT', 'INSUFFICIENT_BALANCE', 'SEND_FAILED', 'REJECTED', 'RPC_UNAVAILABLE'].includes(code)
        ? code
        : 'SEND_FAILED');
      haptic?.('error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="stack sol-wal" style={{ gap: 12 }}>
      <section className="wallet-hero-modern sol-wal-hero">
        <div className="wallet-hero-aurora" aria-hidden="true" />
        <div className="sol-wal-hero-body">
          <div className="row-between" style={{ gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4 }}>{t('solana.title')}</div>
              <div className="sol-wal-addr">
                {address ? shortAddress(address, 6) : t('solana.notConnected')}
              </div>
              {walletName && address ? <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>{walletName}</div> : null}
            </div>
            {address ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onDisconnect}>{t('wallet.disconnect')}</button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={onConnect} data-testid="solana-connect">{t('wallet.connect')}</button>
            )}
          </div>

          {address && (
            <div className="sol-wal-balance">
              <span className="faint">{t('solana.balance')}</span>
              <strong className="mono">
                {balanceLoading
                  ? t('common.loading')
                  : balanceFailed || balance == null
                    ? '—'
                    : `${balance} SOL`}
              </strong>
            </div>
          )}

          {address && (
            <div className="sol-wal-actions" role="group" aria-label={t('solana.wallet.actions')}>
              <Action label={t('solana.wallet.send')} testId="sol-wal-send" action="send" Icon={IconSend} onClick={() => { haptic?.('select'); setSendOpen(true); }} />
              <Action label={t('solana.wallet.receive')} testId="sol-wal-receive" action="receive" Icon={IconReceive} onClick={() => { haptic?.('select'); setReceiveOpen(true); }} />
              <Action label={t('solana.wallet.bridge')} testId="sol-wal-bridge" action="bridge" Icon={IconGlobe} onClick={() => { haptic?.('select'); openAppPath('/bridge?mode=solana'); }} />
              <Action label={t('solana.wallet.swap')} testId="sol-wal-swap" action="swap" Icon={IconSwap} onClick={() => { haptic?.('select'); openAppPath('/swap?chain=solana'); }} />
            </div>
          )}
        </div>
      </section>

      {address && (
        <section className="card sol-wal-holdings">
          <div className="row-between" style={{ marginBottom: 10 }}>
            <span className="section-label" style={{ margin: 0 }}>{t('solana.wallet.holdings')}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} disabled={loading}>
              {loading ? t('common.loading') : t('common.refresh')}
            </button>
          </div>
          {holdingsCode && (
            <p className="notice" style={{ marginTop: 0 }}>
              {t(`solana.err.${holdingsCode}`, t('solana.err.RPC_UNAVAILABLE'))}
            </p>
          )}
          {partial && !holdingsCode && (
            <p className="faint" style={{ fontSize: 12, lineHeight: 1.7, marginTop: 0 }}>{t('solana.wallet.partial')}</p>
          )}
          {!holdingsCode && !loading && holdings && holdings.length === 0 && (
            <p className="muted" style={{ margin: 0 }}>{t('solana.wallet.empty')}</p>
          )}
          <div className="stack" style={{ gap: 8 }}>
            {(holdings || []).map((row) => (
              <div key={row.mint} className="wallet-token-row-modern sol-wal-row">
                <TokenIcon token={{ symbol: row.symbol, icon: row.icon, mint: row.mint }} size={34} />
                <span className="sol-wal-row-main">
                  <strong>{row.symbol}</strong>
                  <small className="faint">{row.name || row.mint.slice(0, 4) + '…' + row.mint.slice(-4)}</small>
                </span>
                <span className="mono sol-wal-row-amt">
                  {row.unread || row.amount == null ? '—' : row.amount}
                </span>
              </div>
            ))}
          </div>
          {holdings?.some((row) => !row.native) && (
            <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.7, margin: '10px 0 0' }}>{t('solana.wallet.splNote')}</p>
          )}
        </section>
      )}

      <Sheet open={sendOpen} onClose={() => { setSendOpen(false); setSendErr(null); setScanOpen(false); }} title={t('solana.wallet.sendTitle')}>
        <p className="notice" style={{ marginTop: 0 }}>{t('solana.wallet.sendOnly')}</p>
        <label className="field-label">{t('solana.wallet.recipient')}</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            type="text"
            value={to}
            dir="ltr"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => { setTo(e.target.value.trim()); setSendErr(null); }}
            placeholder={t('solana.wallet.recipient')}
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
        <label className="field-label" style={{ marginTop: 10 }}>{t('solana.wallet.amount')}</label>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => { setAmount(e.target.value.replace(/[^\\d.]/g, '')); setSendErr(null); }}
          placeholder="0.0"
        />
        <p className="faint" style={{ marginTop: 8 }}>
          {t('solana.balance')}: {solRow?.unread || solRow?.amount == null ? '—' : `${solRow.amount} SOL`}
        </p>
        {sendErr && (
          <p className="notice notice-danger">
            {sendErr === 'BAD_ADDRESS'
              ? t('solana.wallet.badAddress')
              : t(`solana.err.${sendErr}`, t('solana.err.SEND_FAILED'))}
          </p>
        )}
        {sendSig && (
          <a className="notice" href={`https://solscan.io/tx/${encodeURIComponent(sendSig)}`} target="_blank" rel="noopener noreferrer">
            {t('swap.viewOnExplorer')}
          </a>
        )}
        <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} disabled={sending} onClick={submitSend}>
          {sending ? t('common.loading') : t('solana.wallet.sendCta')}
        </button>
      </Sheet>

      <QrScanner open={scanOpen} onClose={() => setScanOpen(false)} onResult={handleScanResult} parse={parseScanned} />

      <Sheet open={receiveOpen} onClose={() => setReceiveOpen(false)} title={t('solana.wallet.receiveTitle')}>
        {qr && (
          <div className="sol-wal-qr">
            <svg viewBox={`0 0 ${qr.count} ${qr.count}`} shapeRendering="crispEdges" role="img" aria-label={t('solana.wallet.receiveTitle')}>
              <path d={qr.d} fill="#000" />
            </svg>
          </div>
        )}
        <p className="mono sol-wal-full-addr" dir="ltr">{address}</p>
        <p className="notice">{t('solana.wallet.receiveHint')}</p>
        <button type="button" className="btn btn-primary" onClick={copy}>
          {copied ? t('solana.wallet.copied') : t('solana.wallet.copy')}
        </button>
      </Sheet>
    </div>
  );
}
