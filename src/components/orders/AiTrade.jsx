import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SPECULATION_ENABLED } from '../../lib/features';
import { aiTradeCopyFor } from '../../lib/aiTradeCopy';
import { HYPERLIQUID_PER_TX_CAP_USD } from '../../lib/hyperliquid/caps';

export default function AiTrade({ lang }) {
  if (!SPECULATION_ENABLED) return null;
  const { i18n } = useTranslation();
  const copy = aiTradeCopyFor(lang || i18n?.language);
  const [kill, setKill] = useState(false);
  const [holding, setHolding] = useState(false);

  const onKill = useCallback(() => {
    const ok = window.confirm(copy.killSwitchConfirm);
    if (ok) setKill(true);
  }, [copy.killSwitchConfirm]);

  return (
    <section className="ai-trade" dir="rtl">
      <header className="ai-trade__head">
        <h2>{copy.tabTitle}</h2>
        <button
          type="button"
          className="ai-trade__kill"
          onClick={onKill}
          aria-pressed={kill}
        >
          {copy.killSwitch}
        </button>
      </header>
      <p className="ai-trade__warn">{copy.mainKeyWarning}</p>
      <p className="ai-trade__body">{copy.sectionBody}</p>
      <div className="ai-trade__caps">
        <span>{copy.caps.perTx}</span>
        <span>{copy.caps.totalExposure}</span>
      </div>
      <div className="ai-trade__unknown">{copy.unknown}</div>
      <button
        type="button"
        className="ai-trade__confirm"
        onMouseDown={() => setHolding(true)}
        onMouseUp={() => setHolding(false)}
      >
        {copy.confirmHold}
      </button>
      <small>per-tx cap: {HYPERLIQUID_PER_TX_CAP_USD}</small>
    </section>
  );
}
