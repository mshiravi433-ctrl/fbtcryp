import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import AdBanner from '../components/AdBanner';
import { useTelegram } from '../context/TelegramContext';
import { useWallet, shortAddress } from '../context/WalletContext';
import SendSheet from '../components/SendSheet';
import TapToPay from '../components/TapToPay';
import P2PMarket from '../components/P2PMarket';
import {
  IconArrowUpRight, IconCard, IconCheck, IconChevronLeft, IconShield, IconSwap, IconTrend, IconWallet
} from '../components/Icons';
import SegIndicator from '../components/SegIndicator';
import PayGatewayPanel from '../components/PayGatewayPanel';
import '../styles/pay-gateway.css';
import '../styles/p2p-modern.css';

const TAB_KEYS = ['market', 'otc', 'pay'];
const TAB_ICONS = { market: IconTrend, otc: IconSwap, pay: IconCard };
const SCAMS = ['reversal', 'thirdParty', 'offPlatform', 'overpay'];

export default function P2P() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const wallet = useWallet();
  const [tab, setTab] = useState('market');
  const [sendOpen, setSendOpen] = useState(false);
  const tabRefs = useRef({});

  const selectTab = (next, moveFocus = false) => {
    setTab(next);
    setSendOpen(false);
    haptic?.('select');
    if (moveFocus) requestAnimationFrame(() => tabRefs.current[next]?.focus());
  };

  const handleTabKeyDown = (event, current) => {
    const rtl = document.documentElement.dir === 'rtl';
    const step = (event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0);
    let next = null;
    if (step) {
      const index = TAB_KEYS.indexOf(current);
      next = TAB_KEYS[(index + step + TAB_KEYS.length) % TAB_KEYS.length];
    } else if (event.key === 'Home') next = TAB_KEYS[0];
    else if (event.key === 'End') next = TAB_KEYS[TAB_KEYS.length - 1];
    if (!next) return;
    event.preventDefault();
    selectTab(next, true);
  };

  return (
    <PageTransition>
      <div className="p2p-page">
        <motion.header className="p2p-hero" variants={riseIn} initial="hidden" animate="show">
          <div className="p2p-hero-orbit p2p-hero-orbit-one" aria-hidden="true" />
          <div className="p2p-hero-orbit p2p-hero-orbit-two" aria-hidden="true" />
          <div className="p2p-hero-content">
            <div className="p2p-hero-topline">
              <button className="icon-btn p2p-back" type="button" onClick={() => navigate(-1)} aria-label={t('common.back')}>
                <IconChevronLeft width={18} height={18} />
              </button>
              <span className="p2p-eyebrow"><span className="p2p-eyebrow-dot" />{t('p2p.eyebrow')}</span>
            </div>
            <h1 className="p2p-title">{t('p2p.title')}</h1>
            <p className="p2p-subtitle">{t('p2p.subtitle')}</p>
            <div className="p2p-hero-footnote">
              <IconShield width={14} height={14} aria-hidden="true" />
              <span>{t('p2p.heroNote')}</span>
            </div>
          </div>
          <div className="p2p-hero-mark" aria-hidden="true">
            <span className="p2p-hero-mark-ring p2p-hero-mark-ring-outer" />
            <span className="p2p-hero-mark-ring p2p-hero-mark-ring-inner" />
            <span className="p2p-hero-mark-icon"><IconSwap width={30} height={30} /></span>
            <span className="p2p-hero-mark-orbit p2p-hero-mark-orbit-a" />
            <span className="p2p-hero-mark-orbit p2p-hero-mark-orbit-b" />
          </div>
        </motion.header>

        <nav className="segmented seg-lg p2p-main-tabs" role="tablist" aria-label={t('p2p.tabListLabel')}>
          {TAB_KEYS.map((key) => {
            const Icon = TAB_ICONS[key];
            const active = tab === key;
            return (
              <button
                key={key}
                ref={(node) => { tabRefs.current[key] = node; }}
                type="button"
                role="tab"
                id={`p2p-tab-${key}`}
                aria-controls="p2p-active-panel"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className={active ? 'active' : ''}
                onClick={() => selectTab(key)}
                onKeyDown={(event) => handleTabKeyDown(event, key)}
                style={{ isolation: 'isolate' }}
              >
                {active && <SegIndicator id="p2p-main-tabs" className="seg-indicator p2p-tab-indicator" />}
                <span className="p2p-tab-icon"><Icon width={16} height={16} /></span>
                <span className="p2p-tab-copy">
                  <span className="p2p-tab-label">{t(`p2p.tab.${key}`)}</span>
                  <span className="p2p-tab-hint">{t(`p2p.tabHint.${key}`)}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <motion.div
          key={tab}
          id="p2p-active-panel"
          className={`p2p-tab-panel p2p-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`p2p-tab-${tab}`}
          tabIndex={0}
          variants={riseIn}
          initial="hidden"
          animate="show"
        >
          {tab === 'market' ? (
            <>
              <div className="p2p-section-heading">
                <div>
                  <span className="p2p-section-kicker">{t('p2p.marketKicker')}</span>
                  <h2>{t('p2p.marketHeading')}</h2>
                  <p>{t('p2p.marketIntro')}</p>
                </div>
                <span className="p2p-market-badge"><IconTrend width={14} height={14} />{t('p2p.marketBadge')}</span>
              </div>

              <motion.section className="p2p-escrow-note" variants={riseIn} initial="hidden" animate="show" aria-label={t('p2p.escrowTitle')}>
                <span className="p2p-note-icon"><IconShield width={19} height={19} /></span>
                <div className="p2p-escrow-copy">
                  <div className="p2p-escrow-heading">
                    <h3>{t('p2p.escrowTitle')}</h3>
                    <span>{t('p2p.escrowBadge')}</span>
                  </div>
                  <p>{t('p2p.escrowBody')}</p>
                </div>
              </motion.section>

              <P2PMarket />

              <section className="p2p-safety-section" aria-labelledby="p2p-safety-title">
                <div className="p2p-safety-heading">
                  <span className="p2p-safety-icon"><IconShield width={17} height={17} /></span>
                  <div>
                    <h2 id="p2p-safety-title">{t('p2p.safetyHeading')}</h2>
                    <p>{t('p2p.safetyIntro')}</p>
                  </div>
                </div>
                <div className="p2p-safety-grid">
                  <InfoBox title={t('p2p.scamsTitle')} tone="warn" id="p2p-scams">
                    <p style={{ marginBottom: 10 }}>{t('p2p.scamsIntro')}</p>
                    <div className="stack" style={{ gap: 10 }}>
                      {SCAMS.map((key, index) => (
                        <div key={key} className="row p2p-scam-row" style={{ gap: 10, alignItems: 'flex-start' }}>
                          <span className="p2p-scam-index">{index + 1}</span>
                          <div>
                            <div className="p2p-scam-title">{t(`p2p.scam.${key}.title`)}</div>
                            <p className="prose-sm" style={{ marginTop: 3 }}>{t(`p2p.scam.${key}.body`)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </InfoBox>
                  <InfoBox title={t('p2p.cashTitle')} tone="warn" id="p2p-cash">
                    <p>{t('p2p.cashBody')}</p>
                  </InfoBox>
                  <InfoBox title={t('p2p.noticeTitle')} tone="danger" id="p2p-notice">
                    <p>{t('p2p.notice')}</p>
                  </InfoBox>
                </div>
              </section>
            </>
          ) : tab === 'otc' ? (
            <>
              <motion.section className="p2p-otc-hero" variants={riseIn} initial="hidden" animate="show">
                <div className="p2p-otc-hero-top">
                  <span className="p2p-otc-icon"><IconSwap width={21} height={21} /></span>
                  <span className="p2p-otc-badge"><span className="p2p-otc-badge-dot" />{t('p2p.otcBadge')}</span>
                </div>
                <h2>{t('p2p.otcTitle')}</h2>
                <p>{t('p2p.otcBody')}</p>
                <div className="p2p-otc-facts">
                  <div className="p2p-otc-fact">
                    <span className="p2p-fact-icon"><IconWallet width={15} height={15} /></span>
                    <span>{t('p2p.otcFact.wallet')}</span>
                  </div>
                  <div className="p2p-otc-fact">
                    <span className="p2p-fact-icon"><IconCheck width={15} height={15} /></span>
                    <span>{t('p2p.otcFact.agreement')}</span>
                  </div>
                  <div className="p2p-otc-fact">
                    <span className="p2p-fact-icon"><IconShield width={15} height={15} /></span>
                    <span>{t('p2p.otcFact.escrow')}</span>
                  </div>
                </div>
              </motion.section>

              <div className="p2p-otc-grid">
                <motion.section className="p2p-send-card" variants={riseIn} initial="hidden" animate="show">
                  <div className="p2p-send-card-head">
                    <span className="p2p-send-icon"><IconArrowUpRight width={19} height={19} /></span>
                    <div className="p2p-send-title-wrap">
                      <span className="p2p-section-kicker">{t('p2p.sendKicker')}</span>
                      <h3>{t('p2p.sendDirect')}</h3>
                    </div>
                    <span className={`p2p-wallet-status ${wallet.isConnected ? 'is-connected' : 'is-disconnected'}`}>
                      <span />{wallet.isConnected ? t('p2p.walletReady') : t('p2p.walletNeeded')}
                    </span>
                  </div>

                  {wallet.isConnected ? (
                    <>
                      <div className="p2p-wallet-preview">
                        <div className="p2p-wallet-network">
                          <span className="p2p-network-mark"><IconSwap width={14} height={14} /></span>
                          <div>
                            <span className="p2p-wallet-label">{t('p2p.networkLabel')}</span>
                            <strong>{wallet.chainOk ? (wallet.chain?.name || String(wallet.chainId)) : t('p2p.chainId', { id: wallet.chainId })}</strong>
                          </div>
                        </div>
                        <div className="p2p-wallet-address">
                          <span className="p2p-wallet-label">{t('p2p.yourAddress')}</span>
                          <strong className="mono" dir="ltr">{shortAddress(wallet.address, 5)}</strong>
                        </div>
                      </div>
                      <button className="btn btn-primary p2p-send-button" type="button" onClick={() => setSendOpen(true)}>
                        <IconArrowUpRight width={16} height={16} />
                        {t('p2p.openSend')}
                      </button>
                    </>
                  ) : (
                    <div className="p2p-wallet-empty">
                      <p>{t('p2p.connectFirst')}</p>
                      <button className="btn btn-primary p2p-send-button" type="button" onClick={() => navigate('/wallet')}>
                        <IconWallet width={16} height={16} />
                        {t('wallet.connect')}
                      </button>
                    </div>
                  )}

                  <div className="p2p-irreversible-note" role="note">
                    <IconShield width={15} height={15} aria-hidden="true" />
                    <p>{t('p2p.otcNotice')}</p>
                  </div>
                </motion.section>

                <motion.section className="p2p-checklist-card" variants={riseIn} initial="hidden" animate="show">
                  <div className="p2p-checklist-head">
                    <span className="p2p-checklist-icon"><IconCheck width={17} height={17} /></span>
                    <div>
                      <h3>{t('p2p.stepsTitle')}</h3>
                      <p>{t('p2p.stepsHint')}</p>
                    </div>
                  </div>
                  <ol className="p2p-steps">
                    {['s1', 's2', 's3', 's4', 's5'].map((key) => <li key={key}>{t(`p2p.step.${key}`)}</li>)}
                  </ol>
                </motion.section>
              </div>

              <InfoBox title={t('tap.title')} tone="info" id="tap-to-pay" icon={<IconCard width={16} height={16} />}>
                <TapToPay onAddress={() => setSendOpen(true)} />
              </InfoBox>

              <AdBanner slot="swap" />
              <SendSheet open={sendOpen} onClose={() => setSendOpen(false)} />
            </>
          ) : (
            <div className="p2p-pay-shell">
              <PayGatewayPanel />
            </div>
          )}
        </motion.div>
      </div>
    </PageTransition>
  );
}
