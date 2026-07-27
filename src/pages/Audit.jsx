import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { FEE_BPS, FEE_RECIPIENT, EVM_CHAINS } from '../lib/chains';
import { IconChevronLeft, IconExternal, IconShield } from '../components/Icons';

/**
 * Security & audit transparency.
 *
 * States plainly which contracts are audited by third parties (PancakeSwap,
 * KyberSwap) and which are ours and NOT yet audited. Claiming an audit we
 * don't have would be the single most damaging lie this app could tell, so
 * the unaudited status is shown as prominently as the audited ones.
 */
export default function Audit() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();

  const open = (url) => {
    haptic?.('light');
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const AUDITED = [
    { id: 'kyber', url: 'https://docs.kyberswap.com/security/audits' },
    { id: 'pancake', url: 'https://docs.pancakeswap.finance/readme/audits' },
    { id: 'walletconnect', url: 'https://docs.reown.com' }
  ];

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('audit.title')}</h1>
      </motion.div>

      <p className="muted">{t('audit.intro')}</p>

      <motion.section className="card card-rgb edge-mint" variants={riseIn} initial="hidden" animate="show">
        <div className="aurora" />
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--rgb-4)' }}><IconShield width={21} height={21} /></span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{t('audit.nonCustodial')}</div>
            <p className="muted" style={{ fontSize: 12.2, margin: 0 }}>{t('audit.nonCustodialBody')}</p>
          </div>
        </div>
      </motion.section>

      <section>
        <p className="section-label">{t('audit.audited')}</p>
        <motion.div className="stack" style={{ gap: 8, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
          {AUDITED.map((a) => (
            <motion.button key={a.id} className="wallet-option" variants={riseIn} whileTap={{ scale: 0.985 }} onClick={() => open(a.url)}>
              <span className="wallet-badge" style={{ color: 'var(--up)' }}><IconShield width={19} height={19} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: 13 }}>{t(`audit.item.${a.id}.name`)}</span>
                <span className="set-row-sub">{t(`audit.item.${a.id}.desc`)}</span>
              </span>
              <IconExternal width={16} height={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            </motion.button>
          ))}
        </motion.div>
      </section>

      <section>
        <p className="section-label">{t('audit.ours')}</p>
        <motion.div className="card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 8 }}>
          <div className="row-between" style={{ marginBottom: 9 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>FeeRouter.sol</span>
            <span className="pill pill-down">{t('audit.notAudited')}</span>
          </div>
          <p className="muted" style={{ fontSize: 12.2 }}>{t('audit.ourContractBody')}</p>
          <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 10 }}
            onClick={() => open('https://github.com/mshiravi433-ctrl/fbtcryp/blob/main/contracts/FeeRouter.sol')}>
            {t('audit.readSource')}
          </button>
        </motion.div>
      </section>

      <section>
        <p className="section-label">{t('audit.feeTransparency')}</p>
        <motion.div className="card stack" style={{ gap: 8, marginTop: 8 }} variants={riseIn} initial="hidden" animate="show">
          <div className="row-between">
            <span className="faint">{t('audit.feeRate')}</span>
            <span className="mono">{FEE_BPS / 100}%</span>
          </div>
          <div className="row-between">
            <span className="faint">{t('audit.feeWallet')}</span>
            <span className="mono" style={{ fontSize: 10.5 }}>{FEE_RECIPIENT.slice(0, 10)}…{FEE_RECIPIENT.slice(-6)}</span>
          </div>
          <div className="row-between">
            <span className="faint">{t('audit.network')}</span>
            <span className="mono" style={{ fontSize: 11.5 }}>{EVM_CHAINS[56].name}</span>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }}
            onClick={() => open(`${EVM_CHAINS[56].explorer}/address/${FEE_RECIPIENT}`)}>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
              <IconExternal width={14} height={14} /> {t('audit.viewOnChain')}
            </span>
          </button>
        </motion.div>
      </section>

      <p className="notice">{t('audit.bounty')}</p>
    </PageTransition>
  );
}
