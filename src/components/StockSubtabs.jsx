import { useTranslation } from 'react-i18next';
import '../styles/stock-subtabs.css';

const SETS = {
  equity: [
    { id: 'tokenized', label: 'stocks.subtab.tokenized', icon: 'tokenized' },
    { id: 'robinhood', label: 'stocks.subtab.robinhood', icon: 'robinhood' },
    { id: 'gold', label: 'stocks.subtab.gold', icon: 'gold' }
  ],
  rwa: [
    { id: 'assets', label: 'stocks.subtab.realAssets', icon: 'assets' },
    { id: 'tokens', label: 'stocks.subtab.rwaTokens', icon: 'tokens' }
  ]
};

function SubtabIcon({ name }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true
  };

  if (name === 'tokenized') {
    return <svg {...common}><path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" /><path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5" /></svg>;
  }
  if (name === 'robinhood') {
    return <svg {...common}><path d="M8 4.5h8a3.5 3.5 0 0 1 0 7H8a3.5 3.5 0 0 1 0-7Z" /><path d="M16 12.5H8a3.5 3.5 0 0 0 0 7h8a3.5 3.5 0 0 0 0-7Z" /><path d="m7.5 8 2 0m5 8h2" /></svg>;
  }
  if (name === 'gold') {
    return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M14.8 8.9c-.6-.7-1.5-1.1-2.7-1.1-1.5 0-2.6.8-2.6 2s1 1.8 2.6 2.2 2.6 1 2.6 2.2-1.1 2-2.7 2c-1.1 0-2.1-.4-2.8-1.2M12 6v12" /></svg>;
  }
  if (name === 'assets') {
    return <svg {...common}><path d="M3.5 20.5h17M5.5 20.5V9l6.5-5 6.5 5v11.5" /><path d="M9 20.5v-6h6v6M9 10.5h.01M15 10.5h.01" /></svg>;
  }
  return <svg {...common}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.6 8-4.6M12 12.1V21M8 5.3l8 4.6" /></svg>;
}

/** Compact, accessible tabs for the asset sub-sections. Inline SVGs keep the
 * controls crisp without adding a font, network request, or icon dependency. */
export default function StockSubtabs({ kind, active, onChange }) {
  const { t } = useTranslation();
  const items = SETS[kind] || [];
  const labels = {
    equity: t('stocks.tab.equity'),
    rwa: t('stocks.tab.rwa')
  };

  return (
    <div
      className={`stock-subtabs stock-subtabs--${kind}`}
      role="tablist"
      aria-label={labels[kind]}
      data-testid={`stocks-${kind}-subtabs`}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          id={`stocks-${kind}-${item.id}-tab`}
          role="tab"
          aria-selected={active === item.id}
          aria-controls={`stocks-${kind}-panel`}
          tabIndex={active === item.id ? 0 : -1}
          className={`stock-subtab${active === item.id ? ' is-active' : ''}`}
          data-subtab={item.id}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => {
            if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const current = items.findIndex((candidate) => candidate.id === item.id);
            const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
            const direction = (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1);
            const next = event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (current + direction + items.length) % items.length;
            onChange(items[next].id);
            document.getElementById(`stocks-${kind}-${items[next].id}-tab`)?.focus();
          }}
        >
          <SubtabIcon name={item.icon} />
          <span>{t(item.label)}</span>
        </button>
      ))}
    </div>
  );
}
