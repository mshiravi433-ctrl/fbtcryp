import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import VaultCard from '../components/VaultCard';
import { vaultConfig } from '../lib/vault';
import { IconChevronLeft, IconShield } from '../components/Icons';

/**
 * VAULT — the route behind the Earn row.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS PAGE EXISTS AT ALL ────────────────────────────────────────────
 * The vault was a card with no address of its own: it rendered on top of Earn
 * and nowhere else, so "go to the vault" had no destination and the Earn list
 * could not link to it like every other row. A route is what makes it a
 * product rather than a widget.
 *
 * ─── AND WHY IT IS NOT EMPTY WHEN THE VAULT IS NOT DEPLOYED ─────────────────
 * `vaultConfig()` returns null on every deployment until a real Morpho address
 * AND chain are configured, and <VaultCard /> returns null on that — both are
 * locked by the wiring suite, correctly: a card advertising a vault nobody can
 * deposit into is the "wired to nothing" failure this repo has shipped three
 * times.
 *
 * But a ROUTE is different from a card. Someone who lands here has asked a
 * question, and silence is not an answer to a question. So the page says
 * plainly that no vault is deployed on this deployment and points back at the
 * things that do work. That is not a "coming soon" placeholder — it is a true
 * statement about the state of this server, the same shape as the honest
 * not-configured lines on the Developers screen.
 */
export default function Vault() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const vault = vaultConfig();

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10, marginBottom: 4 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ margin: 0, fontSize: 19 }}>{t('vault.pageTitle')}</h1>
      </motion.div>

      {vault ? (
        /*
         * The real card, unchanged: it carries the fee percentage, the
         * bad-debt warning, the explorer link and the non-custodial pill. This
         * page adds nothing to that and must not — the disclosure lives on the
         * card so it cannot be separated from the button.
         */
        <VaultCard />
      ) : (
        <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>
              <IconShield width={19} height={19} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>
                {t('vault.notLive')}
              </div>
              <p className="prose-sm">{t('vault.notLiveBody')}</p>
            </div>
          </div>

          {/*
            ─── THE WAY OUT IS A WORKING SCREEN ────────────────────────────
            A dead end is the expensive version of "not available". Both of
            these are real, in-app and fee-earning, which is the same rule the
            Earn list now runs on.
          */}
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/farm?tab=inapp')}>
              {t('vault.goFarm')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/earn')}>
              {t('vault.goEarn')}
            </button>
          </div>
        </motion.section>
      )}
    </PageTransition>
  );
}
