import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn } from './PageTransition';
import { openUrl } from '../lib/browser';
import { vaultConfig } from '../lib/vault';
import { IconExternal, IconShield } from './Icons';

/**
 * OUR OWN VAULT, shown at the top of Earn — but only once it exists.
 * ---------------------------------------------------------------------------
 * ─── RENDERS NOTHING UNTIL A REAL VAULT IS DEPLOYED ─────────────────────────
 * `vaultConfig()` returns null unless a well-formed address AND a known chain
 * are both configured, and this component returns null on that. There is no
 * "coming soon" state and that is deliberate: a card advertising a product
 * that does not exist teaches the user that the app's claims are aspirational,
 * which is the most expensive thing a money app can teach.
 *
 * Same pattern as the GMX referral, which shipped dormant and worked the day
 * the code was registered.
 *
 * ─── WHY IT SITS ABOVE THE OTHER YIELD ROUTES ───────────────────────────────
 * Every other row on the Earn screen sends the user to somebody else's
 * protocol and earns us nothing. This one is ours. Placing it first is not
 * favouritism — it is the only entry on the page where the app has any
 * ongoing relationship with the outcome, and the user should know which is
 * which.
 *
 * ─── AND WHY THE DISCLOSURE IS ON THE CARD, NOT IN A FOOTNOTE ───────────────
 * We take a percentage of the yield this vault earns. A fee discovered after
 * depositing is the kind that makes someone distrust every other number in the
 * app — the same rule the swap screen and the fiat panel already follow. So
 * the percentage is printed on the card, before the button.
 */
export default function VaultCard() {
  const { t } = useTranslation();
  const vault = vaultConfig();

  /* Not deployed: show nothing at all. */
  if (!vault) return null;

  return (
    <motion.section
      className="card card-rgb edge-mint"
      variants={riseIn}
      initial="hidden"
      animate="show"
    >
      <div className="aurora" />

      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--rgb-4)', flexShrink: 0 }}>
          <IconShield width={20} height={20} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>
            {t('vault.title')}
          </div>
          <p className="prose-sm">{t('vault.body')}</p>
        </div>
      </div>

      <div className="row" style={{ gap: 6, marginTop: 11, flexWrap: 'wrap' }}>
        <span className="pill pill-rgb">{vault.chainName}</span>
        {/* Our cut, stated before the button rather than after the deposit. */}
        <span className="pill pill-neutral">
          {t('vault.feePill', { pct: vault.feePercent })}
        </span>
        <span className="pill pill-up">{t('vault.nonCustodial')}</span>
      </div>

      {/*
        ─── THE HONEST PART ────────────────────────────────────────────────
        We choose which lending markets the money enters. That is a real
        responsibility and a real risk to the user, and stating it here is
        the difference between an investment product and a sales pitch.
      */}
      <p className="notice" style={{ marginTop: 12 }}>{t('vault.risk')}</p>

      <div className="row" style={{ gap: 9, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={() => openUrl(vault.depositUrl)}>
          {t('vault.open')}
        </button>
        {/*
          The contract address, verifiable by anyone. A vault the user cannot
          independently inspect is one they have to take on faith, and faith is
          exactly what a non-custodial product is supposed to remove.
        */}
        <button className="btn btn-ghost" onClick={() => openUrl(vault.explorerUrl)}>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <IconExternal width={14} height={14} />
            {t('vault.verify')}
          </span>
        </button>
      </div>

      <p className="faint" style={{ fontSize: 11.3, marginTop: 9, lineHeight: 1.75 }}>
        {t('vault.venueNote')}
      </p>
    </motion.section>
  );
}
