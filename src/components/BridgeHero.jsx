import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { riseIn } from './PageTransition';
import { IconShield, IconSwap } from './Icons';

/**
 * THE BRIDGE HERO — the banner the bridge screen never had.
 * ---------------------------------------------------------------------------
 * REPORTED: «به صفحه پل یک بنر فوق‌مدرن و زیبا اضافه کن — با تبلیغ پل ترون و
 * سولانا، با اندازه درست. فوق‌مدرن.»
 *
 * ─── WHY A BANNER, AND WHY THESE TWO CHAINS ────────────────────────────────
 * The screen used to open on a one-line title, a subtitle and a segmented
 * control — functional, and completely silent about the two things a bridge is
 * actually FOR here: moving USDT over Tron (where most of this audience already
 * holds it) and SOL over Solana. Both are separate flows with their own rules
 * and their own fee warnings, and both were only discoverable by reading four
 * small tab labels and guessing.
 *
 * So the banner does three jobs at once, in one visual block:
 *   1. says what the screen is (same honest subtitle the page already used);
 *   2. NAMES the two special routes and what each is good at — with the real
 *      trade-offs, not marketing: Tron's flat activation cost, Solana's speed
 *      and its separate fee token;
 *   3. puts a CTA on each card that switches to that tab (a `role="tab"`
 *      elsewhere on the page is not a link a promotion can press for you).
 *
 * ─── WHY IT IS A CARD AND NOT A CAROUSEL ───────────────────────────────────
 * A rotating banner hides two thirds of its content at any moment, and on a
 * phone it moves the tap target while the thumb is already travelling. Two
 * static tiles, side by side on a wide screen and stacked on a narrow one, are
 * readable at a glance and never move.
 *
 * MEMOISED, like the other pure-copy sections on this page: WalletContext
 * re-renders everything on the balance tick, and this block depends on nothing
 * but the language and one callback.
 */
const ChainMark = ({ chain }) => {
  if (chain === 'tron') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M2.6 3.2 21.4 6l-6.1 12.6L2.6 3.2Z" fill="currentColor" opacity="0.18" />
        <path
          d="M2.6 3.2 21.4 6m0 0-6.1 12.6M21.4 6 9.1 9.4m0 0 6.2 9.2m-6.2-9.2-6.5-6.2m12.7 15.4L2.6 3.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 5.4 9 3l3 2.4v3.1L9 10.9 6 8.5V5.4Z" fill="currentColor" />
      <path d="M12 13.2 15 11l3 2.2v3.2L15 18.6l-3-2.2v-3.2Z" fill="currentColor" opacity="0.75" />
      <path d="M6 18.6 9 16.4l3 2.2v3.2L9 24l-3-2.2v-3.2Z" fill="currentColor" opacity="0.5" />
    </svg>
  );
};

const BridgeHero = memo(function BridgeHero({ onSelectMode, routesLive = 0 }) {
  const { t } = useTranslation();

  const cards = [
    {
      id: 'tron',
      chain: 'tron',
      title: t('bridge.hero.tron.title'),
      note: t('bridge.hero.tron.note'),
      cta: t('bridge.hero.tron.cta'),
      tone: 'tron'
    },
    {
      id: 'solana',
      chain: 'solana',
      title: t('bridge.hero.solana.title'),
      note: t('bridge.hero.solana.note'),
      cta: t('bridge.hero.solana.cta'),
      tone: 'solana'
    }
  ];

  return (
    <motion.section
      className="brg-hero"
      variants={riseIn}
      initial="hidden"
      animate="show"
      aria-labelledby="brg-hero-title"
    >
      <span className="brg-hero-aurora" aria-hidden="true" />
      <span className="brg-hero-grid" aria-hidden="true" />

      <header className="brg-hero-head">
        <span className="brg-hero-badge">
          <IconShield width={13} height={13} />
          <span>{t('bridge.hero.badge')}</span>
        </span>
        <h2 className="brg-hero-title" id="brg-hero-title">{t('bridge.hero.title')}</h2>
        <p className="brg-hero-sub">{t('bridge.hero.sub')}</p>
        <ul className="brg-hero-facts">
          <li>
            <b>{routesLive > 0 ? routesLive : '4'}</b>
            <span>{t('bridge.hero.factRoutes')}</span>
          </li>
          <li>
            <b>2</b>
            <span>{t('bridge.hero.factChains')}</span>
          </li>
          <li>
            <b>0.3%</b>
            <span>{t('bridge.hero.factFee')}</span>
          </li>
        </ul>
      </header>

      <div className="brg-hero-cards">
        {cards.map((card) => (
          <article key={card.id} className={`brg-hero-card is-${card.tone}`}>
            <span className="brg-hero-card-mark" aria-hidden="true">
              <ChainMark chain={card.chain} />
            </span>
            <div className="brg-hero-card-copy">
              <h3 className="brg-hero-card-title">{card.title}</h3>
              <p className="brg-hero-card-note">{card.note}</p>
            </div>
            <button
              type="button"
              className="brg-hero-card-cta"
              onClick={() => onSelectMode?.(card.id)}
            >
              <IconSwap width={14} height={14} />
              <span>{card.cta}</span>
            </button>
          </article>
        ))}
      </div>
    </motion.section>
  );
});

export default BridgeHero;
