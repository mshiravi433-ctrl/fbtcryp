import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn } from './PageTransition';
import InfoBox from './InfoBox';
import { hardwareDisclosure, hardwareUrl, hardwareVendors } from '../lib/hardware';
import { openUrl } from '../lib/browser';
import { IconExternal, IconShield } from './Icons';

/**
 * "KEEP YOUR KEYS SOMEWHERE THIS APP CANNOT REACH."
 * ---------------------------------------------------------------------------
 * ─── WHY A COMMERCIAL LINK BELONGS ON THE SECURITY SCREEN ───────────────────
 * It looks like an advert on a page about protecting money, which is exactly
 * the kind of thing that should be argued for rather than assumed.
 *
 * The argument: this app already tells people, repeatedly, that their keys are
 * theirs and that a seed phrase in a screenshot is how savings disappear. The
 * honest end of that advice is a device that keeps the key off the phone
 * entirely. We were giving the advice and then stopping short of the answer.
 *
 * The test a referral has to pass to sit here is: WOULD WE RECOMMEND THIS WITH
 * NO COMMISSION AT ALL? For a hardware wallet the answer is plainly yes — it
 * is already implied by the security copy. That is not true of most affiliate
 * offers, which is why this is the only one in the app.
 *
 * ─── AND IT DOES NOT COMPETE WITH US ────────────────────────────────────────
 * The rule that disqualified nearly every programme reviewed: never sell a
 * customer we already have. A hardware wallet is not a rival exchange.
 * Somebody who buys one still has to swap somewhere, and arrives with more
 * capital and more reason to be careful.
 *
 * ─── IT WORKS BEFORE IT EARNS ───────────────────────────────────────────────
 * `hardwareUrl()` returns the plain shop URL when no affiliate id is set, so
 * this card is useful and truthful today and simply starts paying when the
 * owner sets one env var. That ordering is deliberate: this repo has three
 * times shipped a feature wired to nothing, and the fix is to make the
 * unconfigured state the CORRECT state rather than a broken one.
 */
export default function HardwareWalletCard() {
  const { t } = useTranslation();
  const vendors = hardwareVendors();
  if (!vendors.length) return null;

  return (
    <motion.section variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 4 }}>
      <p className="section-label">
        <IconShield width={13} height={13} style={{ verticalAlign: -2, marginInlineEnd: 5 }} />
        {t('hardware.title')}
      </p>

      <div className="card card-tight" style={{ marginTop: 8 }}>
        <p className="prose-sm" style={{ margin: 0 }}>{t('hardware.intro')}</p>
      </div>

      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
        {vendors.map((v) => {
          /*
           * The disclosure is computed PER VENDOR, not once for the card.
           * Only one of the two may be configured, and showing "we earn a
           * commission" over a link that earns nothing is its own small lie in
           * the opposite direction.
           */
          const disclosure = hardwareDisclosure(v);
          return (
            <button
              key={v.id}
              /*
                `.coin-row-btn`, not an inline width override. A <button>
                sizes to its content, so this needs width:100% — but putting
                it inline is the exact hack `test/wallet-probe.jsx` fails the
                build for, and it is right to: a screenful of inline widths is
                how this layout escaped the stylesheet once already.
              */
              className="coin-row coin-row-btn"
              onClick={() => openUrl(hardwareUrl(v))}
            >
              <div
                className="coin-logo"
                style={{
                  color: 'var(--rgb-4)',
                  borderColor: 'var(--rgb-4)',
                  background: 'color-mix(in srgb, var(--rgb-4) 12%, transparent)'
                }}
              >
                <IconShield width={16} height={16} />
              </div>
              <div className="coin-meta">
                <div className="coin-sym" style={{ textTransform: 'none', fontSize: 13 }}>{v.name}</div>
                <div className="coin-name">{t(v.blurb)}</div>
                {/*
                  The commission is named with its real number rather than
                  hidden behind "we may earn a commission". Somebody who knows
                  it is 10% can weigh the recommendation properly; somebody
                  told only that a relationship exists cannot.
                */}
                {disclosure && (
                  <div className="faint" style={{ fontSize: 10.5, marginTop: 3 }}>
                    {t(disclosure, { vendor: v.name, rate: v.rate })}
                  </div>
                )}
              </div>
              <IconExternal width={14} height={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            </button>
          );
        })}
      </div>

      {/*
        Collapsed, per the standing rule: this explains how a category of
        product works, it does not describe what the next tap does with money.
        It is also where the genuinely important caveat lives — buying one of
        these second-hand, or from a marketplace seller, is a well-known way to
        be handed a device with a pre-generated seed.
      */}
      <InfoBox title={t('hardware.cautionTitle')} tone="warn" id="hw-caution">
        <p>{t('hardware.caution')}</p>
        <p>{t('hardware.notRequired')}</p>
      </InfoBox>
    </motion.section>
  );
}
