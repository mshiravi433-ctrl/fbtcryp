import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import qrcode from 'qrcode-generator';
import Sheet from './Sheet';
import { useWallet } from '../context/WalletContext';
import { EVM_CHAINS } from '../lib/chains';
import { useAppStore } from '../store/useAppStore';
import { IconCopy, IconCheck } from './Icons';

/**
 * RECEIVE — show this wallet's address so someone can pay into it.
 *
 * The other half of SendSheet. Without it the in-app wallet could spend but
 * never be funded, which is the "there's no deposit button" complaint: the
 * answer is that you fund your own wallet, and this is the screen that lets
 * you do it.
 *
 * ─── WHY A LIBRARY AND NOT A HAND-ROLLED ENCODER ───────────────────────────
 * QR encoding is Reed-Solomon error correction plus a masking pass. A subtly
 * wrong implementation still produces a scannable square — it just decodes to
 * different characters. For a wallet address that means funds sent to an
 * address nobody controls, permanently, with the app confidently displaying
 * the code that caused it. That is not a place to save 40 KB, so this uses a
 * tested encoder, and the output is verified against our own scanner's parser
 * in the test suite.
 *
 * ─── WHY THE NETWORK IS SHOUTED ─────────────────────────────────────────────
 * The same 0x address exists on every EVM chain. A sender who picks the wrong
 * network usually loses the funds. So the network name sits directly under the
 * address in the warning colour, and the copy button copies only the address —
 * never a prefixed URI that a sender might paste somewhere that cannot read it.
 */
export default function ReceiveSheet({ open, onClose }) {
  const { t } = useTranslation();
  const wallet = useWallet();
  const notify = useAppStore((st) => st.notify);
  const [copied, setCopied] = useState(false);

  const address = wallet.address;
  const chain = EVM_CHAINS[wallet.chainId];

  /**
   * Render the QR as an SVG path.
   *
   * SVG rather than the library's <img> helper: it scales to any screen
   * without blurring, needs no canvas, and inherits currentColor so it flips
   * correctly between light and dark themes. A blurry QR is a QR that will not
   * scan on the first try.
   */
  const qrPath = useMemo(() => {
    if (!address) return null;
    try {
      // Type 0 = auto-size. 'M' correction tolerates ~15% damage, which is the
      // usual choice for addresses: high enough for a scratched screen, low
      // enough to keep the modules large and easy to focus on.
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
      // Never let a rendering problem hide the address itself — the text below
      // is the authoritative copy anyway.
      return null;
    }
  }, [address]);

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      notify('addressCopied', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked in some WebViews. The address is still on screen
      // and selectable, so this is a downgrade, not a failure.
      notify('copyFailed', 'error');
    }
  };

  const share = async () => {
    if (!address || !navigator.share) return;
    try {
      await navigator.share({ text: address });
    } catch {
      /* the user dismissed the share sheet — not an error */
    }
  };

  /** 4-character groups so the address can be checked or read aloud. */
  const chunked = (a) => (a.match(/.{1,4}/g) ?? []).join(' ');

  if (!address) {
    return (
      <Sheet open={open} onClose={onClose} title={t('receive.title')}>
        <p className="notice">{t('receive.connectFirst')}</p>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('receive.title')}>
      <div className="recv-wrap">
        {qrPath && (
          <div className="recv-qr recv-qr-modern">
            <svg
              viewBox={`0 0 ${qrPath.count} ${qrPath.count}`}
              shapeRendering="crispEdges"
              role="img"
              aria-label={t('receive.title')}
            >
              {/* Quiet zone is provided by the white padding around the SVG;
                  a QR with no margin often fails to scan. */}
              <path d={qrPath.d} fill="#000" />
            </svg>
          </div>
        )}

        <span className="recv-net-pill">
          <span className="recv-net-dot" aria-hidden="true" />
          {t('receive.onlyOn', { network: chain?.name ?? t('receive.unknownNetwork') })}
        </span>

        <div className="recv-addr recv-addr-modern mono">{chunked(address)}</div>

        <div className="recv-actions">
          <button className="recv-btn recv-btn-copy" onClick={copy}>
            {copied ? <IconCheck width={16} height={16} /> : <IconCopy width={16} height={16} />}
            {copied ? t('receive.copied') : t('receive.copy')}
          </button>
          {typeof navigator !== 'undefined' && navigator.share && (
            <button className="recv-btn recv-btn-share" onClick={share}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
              </svg>
              {t('receive.share')}
            </button>
          )}
        </div>

        <p className="notice" style={{ marginTop: 13, width: '100%' }}>{t('receive.warning')}</p>
      </div>

      {/*
        THE BITCOIN LEG OF THE SAME WALLET (BIP-84, same seed — see
        lib/btcWallet.js). Shown only for the unlocked local vault: the BTC
        address is derived from the phrase in memory, exactly like the EVM
        one above, so the two are always covered by the SAME 12-word backup
        — which is what the copy below must say out loud, because a user who
        backed up before this card existed has no reason to believe their
        paper copy covers bitcoin too.
      */}
      <BtcSection />
    </Sheet>
  );
}

/**
 * The bitcoin address of the same vault: index 0, native segwit, QR + copy
 * (the same interaction vocabulary as the EVM half above) plus the two
 * backup truths item 8 requires:
 *   — the EXISTING 12-word backup already covers this bitcoin address;
 *   — the encrypted BACKUP FILE alone (no password memory, no words) is not
 *     a bitcoin recovery plan — the walletBackup warning, re-read from the
 *     existing translation so it can never drift from the EVM copy.
 */
function BtcSection() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const notify = useAppStore((st) => st.notify);
  const [btcAddr, setBtcAddr] = useState(null);
  const [copied, setCopied] = useState(false);

  const unlocked = wallet?.mode === 'local' && !wallet?.locked && Boolean(wallet?.address);

  useEffect(() => {
    if (!unlocked) { setBtcAddr(null); return undefined; }
    let alive = true;
    (async () => {
      const { btcAddressForSigner } = await import('../lib/btcWallet');
      const addr = await btcAddressForSigner(wallet.getSigner?.(), { index: 0 });
      if (alive) setBtcAddr(addr);
    })();
    return () => { alive = false; };
  }, [unlocked, wallet?.address]);

  if (!unlocked) return null;

  const copy = async () => {
    if (!btcAddr) return;
    try {
      await navigator.clipboard.writeText(btcAddr);
      setCopied(true);
      notify('addressCopied', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify('copyFailed', 'error');
    }
  };

  const qr = useMemo(() => {
    if (!btcAddr) return null;
    try {
      const q = qrcode(0, 'M');
      q.addData(btcAddr);
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
  }, [btcAddr]);

  return (
    <div style={{ marginTop: 16 }}>
      <div className="xfer-summary-divider" style={{ margin: '4px 0 14px' }} />
      <div className="row-between" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 12.5 }}>{t('receive.btc.title')}</strong>
        <span className="pill" style={{ fontSize: 9 }}>Bitcoin · bech32</span>
      </div>

      {btcAddr ? (
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          {qr && (
            <div style={{ flexShrink: 0, width: 58, height: 58, padding: 4, background: '#fff', borderRadius: 10 }}>
              <svg viewBox={`0 0 ${qr.count} ${qr.count}`} width="100%" height="100%" shapeRendering="crispEdges" role="img" aria-label={t('receive.btc.title')}>
                <path d={qr.d} fill="#000" />
              </svg>
            </div>
          )}
          <div className="mono" dir="ltr" style={{ flex: 1, fontSize: 10.5, wordBreak: 'break-all', lineHeight: 1.7 }}>
            {(btcAddr.match(/.{1,4}/g) ?? []).join(' ')}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" style={{ borderRadius: 12 }} onClick={copy} aria-label={t('receive.copy')}>
            {copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
          </button>
        </div>
      ) : (
        <p className="faint" style={{ fontSize: 11, margin: 0 }}>…</p>
      )}

      <p className="notice" style={{ marginTop: 10, fontSize: 11 }}>{t('receive.btc.backupCovered')}</p>
      <p className="faint" style={{ fontSize: 10.5, lineHeight: 1.7, margin: '6px 0 0' }}>{t('wallet.backupWarn')}</p>
    </div>
  );
}
