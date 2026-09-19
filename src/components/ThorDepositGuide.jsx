import { useTranslation } from 'react-i18next';
import InfoBox from './InfoBox';
import { assetChain, assetLabel } from '../lib/thorswap';
import { thorSourceKind } from '../lib/thorDeposit';
import '../styles/bridge-safety.css';

export default function ThorDepositGuide({ from, to }) {
  const { t } = useTranslation();
  const values = { source: assetChain(from), target: assetChain(to), asset: assetLabel(from) };
  return (
    <div className="thor-guide">
      <InfoBox title={t('thor.guide.title')} id="thor-deposit-guide" defaultOpen>
        <p>{t('thor.guide.manual')}</p>
        <ol>
          <li><strong>{t('thor.guide.walletTitle')}</strong><p>{t('thor.guide.wallet', values)}</p></li>
          <li><strong>{t('thor.guide.receiveTitle')}</strong><p>{t('thor.guide.receive', values)}</p></li>
          <li><strong>{t('thor.guide.routeTitle')}</strong><p>{t(`thor.guide.${thorSourceKind(from)}`, values)}</p></li>
          <li><strong>{t('thor.guide.reviewTitle')}</strong><p>{t('thor.guide.review', values)}</p></li>
          <li><strong>{t('thor.guide.trackTitle')}</strong><p>{t('thor.guide.track')}</p></li>
        </ol>
        <p className="notice notice-danger">{t('thor.guide.noSend')}</p>
        <a className="btn btn-ghost btn-sm" href="https://app.thorswap.finance/" target="_blank" rel="noopener noreferrer">{t('thor.guide.openSwap')} ↗</a>
        <p className="faint">{t('thor.guide.external')}</p>
        <a href="https://dev.thorchain.org/concepts/sending-transactions.html" target="_blank" rel="noopener noreferrer">{t('thor.guide.docs')} ↗</a>
      </InfoBox>
    </div>
  );
}
