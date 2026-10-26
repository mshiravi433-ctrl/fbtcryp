import { motion } from 'framer-motion';
import InfoBox from '../InfoBox';
import RwaRow from '../RwaRow';
import { IconSearch } from '../Icons';
import { stagger } from '../PageTransition';
import { feePercentString } from '../../lib/feeBps';
import { RWA_CATEGORIES } from '../../lib/rwaTokens';

export default function RwaAssetsPanel({
  t,
  isRTL,
  haptic,
  rwaCategory,
  setRwaCategory,
  rwaSearch,
  setRwaSearch,
  AMOUNTS,
  amount,
  setAmount,
  tradeableRwa,
  buyRwa,
  selectRwa
}) {
  return (
    <>
      {/* ─── TRADEABLE RWA TOKENS (WITH 0.70% PLATFORM FEE) ─── */}
      <section style={{ marginTop: 16 }}>
        <div className="row-between" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          <div>
            <p className="section-label" style={{ margin: 0 }}>{t('stocks.rwaTradeable')}</p>
            <p className="farm-filtered faint" style={{ margin: '3px 0 0' }}>{t('stocks.rwaTradeableSub')}</p>
          </div>
          <span className="pill pill-up mono" style={{ fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {feePercentString()}% {t('stocks.rwaFeeChip')}
          </span>
        </div>

        {/* Category filter tags */}
        <div className="tag-scroll" style={{ marginTop: 8, marginBottom: 10 }}>
          {RWA_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`tag ${rwaCategory === cat.id ? 'active' : ''}`}
              onClick={() => {
                haptic?.('select');
                setRwaCategory(cat.id);
              }}
            >
              {t(cat.key, cat.fallback)}
            </button>
          ))}
        </div>

        {/* Search input for RWA tokens */}
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <input
            type="text"
            className="input"
            style={{
              width: '100%',
              paddingLeft: isRTL ? 12 : 36,
              paddingRight: isRTL ? 36 : 12,
              fontSize: 12.5,
              height: 38
            }}
            placeholder={t('stocks.rwaSearchPlaceholder')}
            value={rwaSearch}
            onChange={(e) => setRwaSearch(e.target.value)}
          />
          <span
            style={{
              position: 'absolute',
              top: '50%',
              transform: 'translateY(-50%)',
              [isRTL ? 'right' : 'left']: 12,
              pointerEvents: 'none',
              color: 'var(--muted)',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <IconSearch width={14} height={14} />
          </span>
        </div>

        {/* Amount quick selector — one line, equal chips, not a wrapped row. */}
        <div className="rwa-amounts" style={{ marginTop: 8, marginBottom: 10 }}>
          <span className="rwa-amounts-label">{t('stocks.ifIBuy')}</span>
          <div className="rwa-amounts-picks">
            {AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                className={`tag ${amount === a ? 'active' : ''}`}
                onClick={() => {
                  haptic?.('select');
                  setAmount(a);
                }}
              >
                {a >= 1000 ? `$${a / 1000}k` : `$${a}`}
              </button>
            ))}
          </div>
        </div>

        {tradeableRwa.length > 0 ? (
          <motion.div
            className="stack"
            style={{ gap: 10 }}
            variants={stagger}
            initial="hidden"
            animate="show"
          >
            {tradeableRwa.map((tok) => (
              <RwaRow
                key={tok.id}
                token={tok}
                amountUsd={amount}
                onBuy={buyRwa}
                onSelect={selectRwa}
              />
            ))}
          </motion.div>
        ) : (
          <p className="notice" style={{ marginTop: 8 }}>
            {t('stocks.rwaNoMatch', 'هیچ دارایی RWA با این مشخصات یافت نشد.')}
          </p>
        )}
      </section>

      {/* Educational InfoBox on RWA Backing & Non-Custodial Protocol */}
      <div style={{ marginTop: 14 }}>
        <InfoBox title={t('stocks.rwaHowItWorksTitle')} tone="info" id="stocks-rwa-how">
          <p>{t('stocks.rwaHowItWorksP1')}</p>
          <p>{t('stocks.rwaHowItWorksP2', { fee: feePercentString() })}</p>
        </InfoBox>
      </div>
    </>
  );
}
