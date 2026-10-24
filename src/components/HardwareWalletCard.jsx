import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn } from './PageTransition';
import InfoBox from './InfoBox';
import { hardwareDisclosure, hardwareUrl, hardwareVendors } from '../lib/hardware';
import { openUrl } from '../lib/browser';
import { IconExternal, IconShield } from './Icons';

/**
 * PHASE 3 — THE SECURITY HUB, NOT JUST TWO BUTTONS.
 *
 * The card used to be a blurb and two links. Everything a buyer of one of
 * these devices actually needs to decide — which model fits a PHONE vs a
 * DESKTOP, how the connection works, whether the firmware is open, and above
 * all HOW TO PROVE THE BOX WAS NEVER OPENED — was in their head or on a
 * YouTube video. A comparison table and the four-step tamper checklist live
 * here because this is the screen where the decision is made, and both are
 * the strongest sales arguments the honest version has: the devices protect
 * exactly the thing this app keeps promising.
 *
 * FACTS POLICY: one row per capability, stated the way the vendors state it.
 * No invented benchmarks, no invented wireless support — where a model
 * lineup differs (entry model USB-C only, premium models add Bluetooth), the
 * row names the difference instead of averaging it. If a fact here ever
 * changes upstream, the fix is ONE translation key.
 */
const COMPARE_ROWS = Object.freeze(['wire', 'mobile', 'suite', 'firmware']);

const AUTHENTICITY_STEPS = Object.freeze(['s1', 's2', 's3', 's4']);

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
    <motion.section className="shop-hardware" variants={riseIn} initial="hidden" animate="show">
      <p className="section-label">
        <IconShield width={13} height={13} style={{ verticalAlign: -2, marginInlineEnd: 5 }} />
        {t('hardware.title')}
      </p>

      <div className="card card-tight shop-hardware-intro">
        <p className="prose-sm">{t('hardware.intro')}</p>
      </div>

      <div className="stack shop-hardware-vendors">
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
              className="coin-row coin-row-btn shop-hardware-vendor"
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
        ─── THE COMPARISON TABLE (collapsed — it explains, no money moves) ──
        Rows are capability ids; every cell is a translation key so no
        sentence about a stranger's product is ever hardcoded. Vendors are
        read from `hardwareVendors()` — the SAME list the buttons above use,
        so a third vendor added to lib/hardware.js appears in the table
        without this component being touched.
      */}
      <InfoBox title={t('hardware.compareTitle')} id="hw-compare" icon={<IconExternal width={14} height={14} />}>
        <div className="hw-compare" role="table" aria-label={t('hardware.compareTitle')}>
          <div className="hw-compare-row hw-compare-head" role="row">
            <span role="columnheader" />
            {vendors.map((v) => (
              <span key={v.id} role="columnheader">{v.name}</span>
            ))}
          </div>
          {COMPARE_ROWS.map((row) => (
            <div key={row} className="hw-compare-row" role="row">
              <span className="hw-compare-label" role="rowheader">{t(`hardware.compare.${row}`)}</span>
              {vendors.map((v) => (
                <span key={v.id} className="hw-compare-cell" role="cell">
                  <span className="hw-compare-vendor">{v.name}</span>
                  <span>{t(`hardware.fact.${v.id}.${row}`)}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </InfoBox>

      {/*
        THE FOUR-STEP TAMPER CHECKLIST — the single most protective five
        minutes in crypto custody, and the reason a box that arrives
        re-shrink-wrapped with a printed seed phrase is not a discount, it is
        a robbery that already happened. Numbered chips rather than bullets:
        a shopper at a doorstep with a parcel in hand should be able to
        count where they are.
      */}
      <InfoBox
        title={t('hardware.checkTitle')}
        tone="info"
        id="hw-check"
        icon={<IconShield width={14} height={14} />}
      >
        <ol className="hw-checklist">
          {AUTHENTICITY_STEPS.map((k) => (
            <li key={k}>{t(`hardware.check.${k}`)}</li>
          ))}
        </ol>
        <p className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>{t('hardware.checkFoot')}</p>
      </InfoBox>

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
