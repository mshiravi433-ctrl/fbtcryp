import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import FancyQr from './FancyQr';
import TokenIcon from '../lib/tokenIcon';
import { shortAddress } from '../context/WalletContext';
import { readSolanaPortfolio } from '../lib/solana/portfolio';
import { solanaExitKind, solanaSellUrl } from '../lib/solanaSell';
import SolanaSendSheet from './SolanaSendSheet';
import { IconSend, IconReceive } from './WalletArt';
import { IconSwap, IconGlobe } from './Icons';

/*
 * The Solana mark for the receive QR's medallion — three slanted bars in the
 * chain's purple→green gradient. Sits on the FancyQr top edge (in the quiet
 * zone, never over a module), which is what makes the Solana receive code a
 * sibling of the EVM one instead of a bare square («ظاهر کیو‌آر کد سولانا»).
 */
function SolMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="solQrMarkG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9945FF" />
          <stop offset="100%" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <path d="M6.4 5.2h13.4L17.3 8.1H3.9z" fill="url(#solQrMarkG)" />
      <path d="M3.9 10.6h13.4l-2.5 2.9H6.4z" fill="url(#solQrMarkG)" />
      <path d="M6.4 15.9h13.4L17.3 18.8H3.9z" fill="url(#solQrMarkG)" />
    </svg>
  );
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
  const [copied, setCopied] = useState(false);

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
                {/*
                  The way OUT of every holding, on the holding itself. Before
                  this the list was display-only: someone who had bought AAPLx
                  from the Stocks page could see it here and had no idea how to
                  turn it back into dollars («چطور بفروشم؟»). The link lands on
                  the swap screen with this token already in the FROM box.
                  SOL and the stables say «تبدیل», because «فروش» for USDC is
                  not what happens.
                */}
                {!row.unread && row.amount != null && solanaSellUrl(row.mint) ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm sol-wal-row-exit"
                    data-testid="sol-wal-exit"
                    data-exit={solanaExitKind(row.mint)}
                    aria-label={`${solanaExitKind(row.mint) === 'sell' ? t('trade.sell') : t('solana.wallet.swap')} ${row.symbol}`}
                    onClick={() => { haptic?.('select'); openAppPath(solanaSellUrl(row.mint)); }}
                  >
                    {solanaExitKind(row.mint) === 'sell' ? t('trade.sell') : t('solana.wallet.swap')}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {holdings?.some((row) => !row.native) && (
            <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.7, margin: '10px 0 0' }}>{t('solana.wallet.splSendable')}</p>
          )}
        </section>
      )}

      {/*
        ─── THE SEND SHEET NOW SENDS EVERYTHING ────────────────────────────
        It used to be inline here, and it used to open with the sentence that
        started this whole item: «این ارسال فقط SOL بومی است و توکن‌های SPL را
        جابه‌جا نمی‌کند». The picker, the amount field and the honest error
        mapping now live in components/SolanaSendSheet.jsx, which handles both
        native SOL and SPL tokens — see that file for the reasoning.
      */}
      <SolanaSendSheet
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        address={address}
        holdings={holdings}
        solBalanceRaw={solRow?.raw ?? null}
        onSent={refresh}
        haptic={haptic}
      />

      <Sheet open={receiveOpen} onClose={() => setReceiveOpen(false)} title={t('solana.wallet.receiveTitle')}>
        <FancyQr
          value={address}
          label={t('solana.wallet.receiveTitle')}
          accent={['#9945FF', '#14F195', '#9945FF']}
          badge={<SolMark />}
        />
        <p className="mono sol-wal-full-addr" dir="ltr">{address}</p>
        <p className="notice">{t('solana.wallet.receiveHint')}</p>
        <button type="button" className="btn btn-primary" onClick={copy}>
          {copied ? t('solana.wallet.copied') : t('solana.wallet.copy')}
        </button>
      </Sheet>
    </div>
  );
}
