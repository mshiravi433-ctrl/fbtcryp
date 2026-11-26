import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import FancyQr from './FancyQr';
import { IconBitcoin } from './WalletArt';
import { IconCheck, IconCopy } from './Icons';
import { useAppStore } from '../store/useAppStore';

/**
 * THE BITCOIN RECEIVE POPUP — opened from the BTC hub, not from the EVM
 * receive sheet. The address is derived once by useBtcHolding (the hub owns
 * that read) and handed down, so this sheet never asks the vault or Esplora
 * for a second copy. The matrix itself uses FancyQr, the same tested encoder
 * as every other receive surface in the app.
 */
export default function BtcReceiveSheet({ open, onClose, address = null, loading = false, error = null }) {
  const { t } = useTranslation();
  const notify = useAppStore((st) => st.notify);
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      notify('addressCopied', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify('copyFailed', 'error');
    }
  }, [address, notify]);

  const share = useCallback(async () => {
    if (!address || !navigator.share) return;
    try {
      await navigator.share({ title: t('wnew.btcReceiveTitle'), text: address });
    } catch {
      /* the user dismissed the native share sheet */
    }
  }, [address, t]);

  const chunked = address ? (String(address).match(/.{1,4}/g) ?? []).join(' ') : '';

  return (
    <Sheet open={open} onClose={onClose} title={t('wnew.btcReceiveTitle')} anchor="center" size="md" testId="btc-receive-sheet">
      <div className="btc-recv">
        <div className="btc-recv-head">
          <span className="btc-recv-mark" aria-hidden="true"><IconBitcoin width={20} height={20} /></span>
          <span>
            <strong>{t('wnew.btcReceiveTitle')}</strong>
            <small>{t('wnew.btcReceiveSub')}</small>
          </span>
        </div>

        {address ? (
          <>
            <FancyQr
              value={address}
              label={t('wnew.btcReceiveTitle')}
              className="btc-recv-qr"
              accent={['#f7931a', '#ffb347', '#ffd166']}
              badge={<IconBitcoin width={19} height={19} />}
            />
            <div className="btc-recv-addr mono" dir="ltr">{chunked}</div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-primary" style={{ flex: 1, minHeight: 46, borderRadius: 14, gap: 7 }} onClick={() => void copy()}>
                {copied ? <IconCheck width={15} height={15} /> : <IconCopy width={15} height={15} />}
                {copied ? t('receive.copied') : t('receive.copy')}
              </button>
              {typeof navigator !== 'undefined' && navigator.share && (
                <button type="button" className="btn btn-ghost" style={{ flex: 1, minHeight: 46, borderRadius: 14 }} onClick={() => void share()}>
                  {t('receive.share')}
                </button>
              )}
            </div>
            <p className="notice" style={{ margin: 0 }}>{t('wnew.btcOnlyNative')}</p>
            <p className="faint" style={{ fontSize: 10.5, lineHeight: 1.7, margin: 0 }}>{t('receive.btc.backupCovered')}</p>
          </>
        ) : (
          <p className="notice" style={{ margin: 0 }}>
            {error ? t(`btc.card.err.${error}`, { defaultValue: t('wnew.btcRecvUnavailable') }) : (loading ? t('wnew.btcRecvLoading') : t('wnew.btcRecvUnavailable'))}
          </p>
        )}
      </div>
    </Sheet>
  );
}
