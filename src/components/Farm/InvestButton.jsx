import { useState } from 'react';
import Sheet from '../Sheet';
import { IconSwap } from '../Icons';
import { pairSwapRoute } from '../../lib/yields';

/**
 * The token-preparation action shared by pool cards, venue analytics and the
 * full-screen pool sheet.
 *
 * A pair needs TWO assets. The old CTA sent token A → token B and called that
 * "get the pair", leaving the user with only one leg. When both verified leg
 * routes exist we now show two explicit, independent swap actions instead.
 * Nothing here deposits into the pool or implies that the two swaps are an LP
 * transaction; the protocol's own pool action remains separate.
 */
export default function InvestButton({ pool, route, onGetTokens, t, className = '', variant = 'ghost' }) {
  const [pairOpen, setPairOpen] = useState(false);
  if (!route) return <span className="farm-unavailable-action faint">{t('farm.noRouteHint')}</span>;

  const isPair = Boolean(pairSwapRoute(pool) && route.legRoutes?.length === 2);
  const label = isPair
    ? t('farm.getTokens', { a: route.from, b: route.to })
    : t('farm.stakeNow', { sym: route.to });

  const activate = () => {
    if (isPair) setPairOpen(true);
    else onGetTokens(route);
  };

  return (
    <>
      <button
        type="button"
        className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-ghost'} farm-btn ${className}`.trim()}
        onClick={activate}
        data-testid={isPair ? `farm-get-pair-${pool.id ?? pool.symbol}` : undefined}
      >
        <IconSwap width={15} height={15} /> {label}
      </button>

      {isPair && (
        <Sheet
          open={pairOpen}
          onClose={() => setPairOpen(false)}
          title={t('farm.pairPrepTitle', { pair: pool.symbol })}
          size="sm"
          className="farm-pair-sheet"
          testId="farm-pair-sheet"
        >
          <div className="farm-pair-intro">
            <span className="farm-pair-mark" aria-hidden="true"><IconSwap width={19} height={19} /></span>
            <div>
              <strong>{t('farm.pairPrepHeading')}</strong>
              <p>{t('farm.pairPrepBody')}</p>
            </div>
          </div>
          <div className="farm-pair-legs">
            {route.legRoutes.map((leg, index) => (
              <button
                type="button"
                className="farm-pair-leg"
                key={`${leg.to}-${index}`}
                data-testid={`farm-pair-leg-${index}`}
                onClick={() => {
                  setPairOpen(false);
                  onGetTokens(leg);
                }}
              >
                <span className="farm-pair-step">{index + 1}</span>
                <span className="farm-pair-leg-copy">
                  <strong dir="ltr">{leg.to}</strong>
                  <small>{t('farm.pairLegPayment', { from: leg.from })}</small>
                </span>
                <span className="farm-pair-leg-action">
                  <IconSwap width={14} height={14} /> {t('farm.pairLegCta')}
                </span>
              </button>
            ))}
          </div>
          <p className="farm-pair-note">{t('farm.pairPrepNote')}</p>
        </Sheet>
      )}
    </>
  );
}
