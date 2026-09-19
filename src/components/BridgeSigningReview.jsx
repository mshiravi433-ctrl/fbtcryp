import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import { BRIDGE_CHAINS, fromBaseUnits } from '../lib/bridge';
import '../styles/bridge-safety.css';

export default function BridgeSigningReview({ review, onDecision }) {
  const { t } = useTranslation();
  const fields = review ? [
    ['token', review.token], ['spender', review.spender],
    ['contract', review.contract], ['recipient', review.recipient]
  ].filter(([, value]) => value) : [];
  return (
    <Sheet open={Boolean(review)} title={t('bridge.safety.title')} onClose={() => onDecision(false)}>
      {review && <div className="bridge-safety">
        <p>{t('bridge.safety.network', {
          network: BRIDGE_CHAINS.find((c) => c.id === Number(review.chainId))?.name || review.chainId,
          provider: review.provider
        })}</p>
        <p className="bridge-safety-amount" dir="ltr">{fromBaseUnits(review.amount, review.decimals)} {review.symbol}</p>
        <p>{t('bridge.safety.explain')}</p>
        {Number(review.chainId) === 56 && review.token?.toLowerCase() === '0x55d398326f99059ff775485246999027b3197955' && <div>
          <p>{t('bridge.safety.bscTokenNote')}</p>
          <a href="https://bscscan.com/token/0x55d398326f99059ff775485246999027b3197955" target="_blank" rel="noopener noreferrer">{t('bridge.safety.explorer')} ↗</a>
        </div>}
        <dl className="bridge-addresses">
          {fields.map(([role, address]) => <div key={role}>
            <dt>{t(`bridge.safety.${role}`)}</dt>
            <dd dir="ltr">{address}</dd>
          </div>)}
        </dl>
        <p className="notice notice-danger" role="note">{t('bridge.safety.warning')}</p>
        <div className="bridge-safety-actions">
          <button type="button" className="btn btn-ghost" onClick={() => onDecision(false)} autoFocus>{t('bridge.cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={() => onDecision(true)}>{t('bridge.safety.continue')}</button>
        </div>
      </div>}
    </Sheet>
  );
}
