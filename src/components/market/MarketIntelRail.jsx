import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MarketFbtNetworks from './MarketFbtNetworks';
import MarketDefiIntel from './MarketDefiIntel';
import MarketCapitalPulse from './MarketCapitalPulse';

const INTEL_TABS = [
  { id: 'networks', labelKey: 'marketPhase2.netTitle' },
  { id: 'defi', labelKey: 'marketPhase2.defiTitle' },
  { id: 'pulse', labelKey: 'marketPhase2.pulseTitle' }
];

function MarketIntelRail({ coins, global, vs, overviewIntel }) {
  const { t } = useTranslation();
  const [active, setActive] = useState('networks');

  return (
    <section className="mx-intel-rail" aria-label={t('marketIntel.overviewAria')}>
      <div className="mx-intel-rail-bar" role="tablist" aria-label={t('marketIntel.overviewAria')}>
        {INTEL_TABS.map((tab) => {
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`mx-intel-rail-tab${selected ? ' is-active' : ''}`}
              onClick={() => setActive(tab.id)}
            >
              <span className="mx-intel-rail-dot" aria-hidden="true" />
              <span>{t(tab.labelKey)}</span>
            </button>
          );
        })}
      </div>

      <div className="mx-intel-rail-panel" role="tabpanel">
        {active === 'networks' && (
          <MarketFbtNetworks swapNetworks={overviewIntel.swapNetworks} />
        )}
        {active === 'defi' && (
          <MarketDefiIntel
            defi={overviewIntel.defi}
            global={global}
            loading={overviewIntel.loading}
            offline={overviewIntel.offline}
            onRefresh={overviewIntel.refresh}
          />
        )}
        {active === 'pulse' && (
          <MarketCapitalPulse coins={coins} global={global} vs={vs} />
        )}
      </div>
    </section>
  );
}

export default memo(MarketIntelRail);
