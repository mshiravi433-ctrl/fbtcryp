/*
 * ─── FIX: THE RECEIVE BUTTON DID NOTHING ────────────────────────────────────
 * Reported as "دکمهٔ دریافت کار نمی‌کند". The handler, the state and the mount
 * were all correct — Wallet.jsx sets `receiveOpen` and renders <ReceiveSheet
 * open={receiveOpen} …>, and WalletActionRow wires onReceive straight through.
 * Nothing was disabled and nothing was conditional.
 *
 * The real cause was one missing import. `BtcSection` at the bottom of this
 * file calls `useEffect`, and this line imported only `useMemo` and `useState`.
 * `useEffect` was therefore a free identifier, so the moment React rendered
 * BtcSection — which happens unconditionally, on the very first render of the
 * sheet — the module threw `ReferenceError: useEffect is not defined`. The
 * RouteBoundary swallowed it and the screen simply never changed, which from
 * the outside is indistinguishable from a dead button.
 *
 * Why no test caught it: a missing binding is not a syntax error, so both
 * `vite build` and every source-grep wiring assertion passed happily. It can
 * only be caught by RENDERING the sheet, which is what the new probe in
 * test/wallet-probe.jsx now does. (The wiring suite also asserts, from here
 * on, that every hook this file calls appears in its react import.)
 *
 * ─── FIX: «فقط روی شبکهٔ X ارسال کن» WAS THE WRONG SENTENCE ────────────────
 * Reported as «مگه آدرس‌ها یکی نیست؟ اگر آره جمله باید عوض شود» — and the
 * reporter was right. The 0x address IS the same on every EVM network, so
 * "only send on THIS network" was not just confusing, it was untrue: a payer
 * who sends USDC on Polygon to this address does NOT lose the funds — they
 * arrive on Polygon and show up in this wallet's multi-chain list.
 *
 * What is actually dangerous — and the only thing the warning now says — is
 * a NON-EVM network: Solana, Bitcoin or Tron carry different address spaces,
 * and a transfer from there to a 0x address is gone for good.
 *
 * ─── WHY THE QR LIVES IN FancyQr ───────────────────────────────────────────
 * The EVM QR, the Bitcoin QR and the Solana wallet's QR are now one
 * component (see components/FancyQr.jsx) — one encoder, one extraordinary
 * frame, one set of scannability rules. The white plate and the matrix path
 * format are what test/inapp-wallet-receive.test.jsx decodes; the beauty is
 * all around them.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import FancyQr from './FancyQr';
import BrandMark from './BrandMark';
import { useWallet } from '../context/WalletContext';
import { EVM_CHAINS } from '../lib/chains';
import { useAppStore } from '../store/useAppStore';
import { IconCopy, IconCheck } from './Icons';
import { IconBitcoin } from './WalletArt';

/** 4-character groups so an address can be checked or read aloud. */
const chunk = (a) => (String(a).match(/.{1,4}/g) ?? []).join(' ');

/**
 * RECEIVE — show this wallet's address so someone can pay into it.
 *
 * The other half of SendSheet. Without it the in-app wallet could spend but
 * never be funded, which is the "there's no deposit button" complaint: the
 * answer is that you fund your own wallet, and this is the screen that lets
 * you do it.
 *
 * The copy button copies only the address — never a prefixed URI that a
 * sender might paste somewhere that cannot read it.
 */
export default function ReceiveSheet({ open, onClose }) {
  const { t } = useTranslation();
  const wallet = useWallet();
  const notify = useAppStore((st) => st.notify);
  const [copied, setCopied] = useState(false);

  const address = wallet.address;
  const chain = EVM_CHAINS[wallet.chainId];

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
  const chunked = useMemo(() => chunk(address), [address]);

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
        <FancyQr
          value={address}
          label={t('receive.title')}
          className="recv-qr"
          accent={['#00e5ff', '#7c4dff', '#00ff9d']}
          badge={<BrandMark size={19} gradientId="recvQrBrand" strokeWidth={2.2} />}
        />

        {/*
          ONE ADDRESS, EVERY EVM NETWORK — the sentence the reporter asked for.
          The network name still sits here (a payer should see it), but as the
          network this wallet is on, not as an exclusive claim on the address.
        */}
        <span className="recv-net-pill">
          <span className="recv-net-dot" aria-hidden="true" />
          {t('receive.sharedEvm')}
          <span className="recv-net-chain">{chain?.name ?? t('receive.unknownNetwork')}</span>
        </span>

        <div className="recv-addr recv-addr-modern mono">{chunked}</div>

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

  const isLocalVault = wallet?.mode === 'local';
  const unlocked = isLocalVault && !wallet?.locked && Boolean(wallet?.address);

  useEffect(() => {
    if (!unlocked) { setBtcAddr(null); return undefined; }
    let alive = true;
    (async () => {
      /* Dynamic, so the bitcoin derivation code is fetched the first time
         someone actually opens Receive on an unlocked vault — it must never
         ride along in the initial bundle. */
      const { btcAddressForSigner } = await import('../lib/btcWallet');
      const addr = await btcAddressForSigner(wallet.getSigner?.(), { index: 0 });
      if (alive) setBtcAddr(addr);
    })();
    return () => { alive = false; };
  }, [unlocked, wallet?.address]);

  /*
   * ─── SECOND FIX IN THE SAME COMPONENT: A HOOK BELOW AN EARLY RETURN ───────
   * `useMemo` used to sit AFTER `if (!unlocked) return null`, so the number of
   * hooks this component calls changed with the lock state. Locking or
   * unlocking the vault while the sheet was open therefore produced React's
   * "Rendered fewer/more hooks than during the previous render" invariant and
   * tore the tree down — the same "sometimes it just breaks" class as the bug
   * above. Every hook now runs unconditionally, before any return. (Today the
   * QR matrix is built inside FancyQr, which owns its own hooks; the two
   * useState calls and the derivation effect above stay above the guard for
   * the same reason, and test/wiring.mjs still asserts it.)
   */

  /*
   * A LOCKED local vault used to render nothing at all here, which reads as
   * "this app has no bitcoin address" — the second half of the reported bug.
   * There is no phrase in memory to derive from (the zero law), so we cannot
   * show the address, but we can say exactly why and what to do.
   */
  if (!unlocked) {
    if (!isLocalVault) return null;
    return (
      <div style={{ marginTop: 16 }}>
        <div className="xfer-summary-divider" style={{ margin: '4px 0 14px' }} />
        <div className="row-between" style={{ marginBottom: 8 }}>
          <strong style={{ fontSize: 12.5 }}>{t('receive.btc.title')}</strong>
          <span className="pill" style={{ fontSize: 9 }}>Bitcoin · bech32</span>
        </div>
        <p className="notice" style={{ margin: 0, fontSize: 11.5 }}>{t('receive.btc.locked')}</p>
      </div>
    );
  }

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

  return (
    <div style={{ marginTop: 16 }}>
      <div className="xfer-summary-divider" style={{ margin: '4px 0 14px' }} />
      <div className="row-between" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 12.5 }}>{t('receive.btc.title')}</strong>
        <span className="pill" style={{ fontSize: 9 }}>Bitcoin · bech32</span>
      </div>

      {btcAddr ? (
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <FancyQr
            compact
            value={btcAddr}
            label={t('receive.btc.title')}
            className="fqr-mini"
            accent={['#f7931a', '#ffb347', '#f7931a']}
            badge={<IconBitcoin width={19} height={19} />}
          />
          <div className="mono" dir="ltr" style={{ flex: 1, fontSize: 10.5, wordBreak: 'break-all', lineHeight: 1.7 }}>
            {chunk(btcAddr)}
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
