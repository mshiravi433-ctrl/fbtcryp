import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { FEE_BPS, FEE_RECIPIENT, EVM_CHAINS } from '../lib/chains';
import { payoutTable } from '../lib/payout';
import { IconChevronLeft, IconExternal, IconKey, IconLock, IconShield } from '../components/Icons';

/**
 * SECURITY.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS PAGE WAS EXPANDED RATHER THAN RESTYLED ────────────────────────
 * It was an audit page: which third-party contracts are audited, which of
 * ours is not, and where the fee lands. All true and all worth keeping — but
 * it answered a question almost nobody asks, while leaving the questions
 * everybody asks unanswered:
 *
 *   • Where is my recovery phrase kept, and who can read it?
 *   • If your server is hacked tomorrow, what happens to my money?
 *   • Does the app lock itself? Is that real protection or theatre?
 *   • What can you see about me?
 *
 * Those are now the first half of the page, because a user deciding whether
 * to trust the app is deciding on those, not on whose auditor signed off on
 * KyberSwap.
 *
 * ─── THE RULE FOR EVERY CLAIM BELOW ─────────────────────────────────────────
 * A security page that overstates anything is worse than no security page,
 * because it converts a cautious user into a careless one. So each item names
 * its limit in the same breath as its benefit — the app lock genuinely stops
 * someone who picks up an unlocked phone and genuinely does NOT stop someone
 * who has the seed phrase, and the copy says both.
 *
 * Every figure here is read from the code, not remembered: 310,000 PBKDF2
 * iterations and AES-GCM are what `src/lib/localWallet.js` actually does.
 */

/**
 * How the app protects you, and exactly how far each protection reaches.
 *
 * `limit` is not optional and is rendered in the same block as the claim.
 * Splitting benefits and caveats into separate sections is how a page ends up
 * being read as reassurance — everyone reads the first half.
 */
const PROTECTIONS = ['keys', 'encryption', 'server', 'lock', 'privacy', 'network'];

/** Things that will actually cost somebody their money, in order of how often. */
const THREATS = ['phrase', 'approvals', 'fakeApps', 'address', 'support'];

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

      <p className="prose-sm">{t('audit.intro')}</p>

      {/* ------------------------ the one that matters ------------------------ */}
      <motion.section 
        className="card" 
        variants={riseIn} 
        initial="hidden" 
        animate="show"
        style={{ 
          background: 'linear-gradient(135deg, rgba(16,185,129,0.08), transparent)',
          border: '1px solid rgba(16,185,129,0.25)'
        }}
      >
        <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
          <div style={{ 
            width: 42, 
            height: 42, 
            borderRadius: 999, 
            background: 'rgba(16,185,129,0.2)',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0
          }}>
            <IconShield width={22} height={22} color="#10b981" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 6, color: '#10b981' }}>{t('audit.nonCustodial')}</div>
            <p className="prose-sm" style={{ lineHeight: 1.65 }}>{t('audit.nonCustodialBody')}</p>
          </div>
        </div>
      </motion.section>

      {/* --------------------------- protections --------------------------- */}
      <section>
        <p className="section-label">{t('audit.howProtected')}</p>
        <motion.div className="stack" style={{ gap: 9, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
          {PROTECTIONS.map((k) => (
            <motion.div key={k} className="card card-tight" variants={riseIn}>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--rgb-1)', flexShrink: 0, marginTop: 1 }}>
                  <IconLock width={16} height={16} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 12.8 }}>{t(`audit.prot.${k}.title`)}</div>
                  <p className="prose-sm" style={{ marginTop: 4, fontSize: 12.2 }}>{t(`audit.prot.${k}.body`)}</p>
                  {/*
                    The limit, in the same card, in warning colour. A caveat
                    placed in a separate "notes" section below is a caveat
                    nobody reads — and on a security page, an unread caveat is
                    how somebody concludes the app protects them from something
                    it does not.
                  */}
                  <p
                    className="prose-sm"
                    style={{
                      marginTop: 6,
                      fontSize: 11.8,
                      color: 'var(--rgb-5)',
                      borderInlineStart: '2px solid var(--rgb-5)',
                      paddingInlineStart: 9
                    }}
                  >
                    {t(`audit.prot.${k}.limit`)}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ----------------------- how people lose money ----------------------- */}
      <section>
        <p className="section-label">{t('audit.threats')}</p>
        <p className="prose-sm" style={{ marginTop: 6, marginBottom: 9 }}>{t('audit.threatsIntro')}</p>
        <motion.div className="stack" style={{ gap: 8 }} variants={stagger} initial="hidden" animate="show">
          {THREATS.map((k, i) => (
            <motion.div key={k} className="card card-tight" variants={riseIn}>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <span
                  className="mono"
                  style={{
                    minWidth: 20, height: 20, borderRadius: 6, display: 'grid', placeItems: 'center',
                    fontSize: 10, fontWeight: 700, flexShrink: 0,
                    background: 'rgba(255,59,107,.16)', color: 'var(--down)'
                  }}
                >
                  {i + 1}
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12.6 }}>{t(`audit.threat.${k}.title`)}</div>
                  <p className="prose-sm" style={{ marginTop: 3, fontSize: 12.2 }}>{t(`audit.threat.${k}.body`)}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* --------------------------- audited code --------------------------- */}
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
          <p className="prose-sm">{t('audit.ourContractBody')}</p>
          {/* The repo is private, so there is no public file to link to.
              Auditors get read access on request; the on-chain address below
              is the part that actually lets anyone verify the fee. */}
          <p className="prose-sm" style={{ marginTop: 9 }}>{t('audit.sourceNote')}</p>
          <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 10 }}
            onClick={() => navigate('/contact')}>
            {t('audit.readSource')}
          </button>
        </motion.div>
      </section>

      {/* ------------------------- fee transparency ------------------------- */}
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
          {/* Every network we accept value on, with the address it lands at
              and the coin that pays gas there. Publishing all of them is the
              point of an audit page: anyone can check on-chain that the fee
              they paid arrived where we said it would. */}
          <div className="stack" style={{ gap: 6, marginTop: 4 }}>
            <span className="faint">{t('audit.network')}</span>
            {payoutTable().map((row) => (
              <div className="row-between" key={row.id} style={{ gap: 10 }}>
                <span className="row" style={{ gap: 7, minWidth: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: row.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{row.label}</span>
                </span>
                <span className="mono faint" style={{ fontSize: 10, direction: 'ltr' }}>
                  {row.address.slice(0, 6)}…{row.address.slice(-4)} · {row.gas}
                </span>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }}
            onClick={() => open(`${EVM_CHAINS[56].explorer}/address/${FEE_RECIPIENT}`)}>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
              <IconExternal width={14} height={14} /> {t('audit.viewOnChain')}
            </span>
          </button>
        </motion.div>
      </section>

      {/* --------------------------- report a bug --------------------------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--rgb-2)' }}><IconKey width={19} height={19} /></span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{t('audit.disclosure')}</div>
            <p className="prose-sm">{t('audit.bounty')}</p>
          </div>
        </div>
      </motion.section>
    </PageTransition>
  );
}
