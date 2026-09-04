/**
 * Glossary — crypto vocabulary for the Lab Learn group.
 *
 * Definitions live in i18n (`lab2.screens.glossary.terms.*`), not in this
 * file. Hard-coding Persian here is why changing the app language left the
 * whole screen in Farsi.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LabBack, Panel, Notice } from './Shared';

const TERM_IDS = [
  'liquidation',
  'ath',
  'atl',
  'altcoin',
  'stablecoin',
  'defi',
  'dex',
  'cex',
  'staking',
  'yield',
  'apy',
  'gas',
  'wallet',
  'privateKey',
  'seed',
  'blockchain',
  'mining',
  'nft',
  'dao',
  'airdrop',
  'fomo',
  'fud',
  'hodl',
  'whale',
  'bull',
  'bear',
  'mcap',
  'tokenVsCoin',
  'cold',
  'hot',
  'smartContract',
  'l2',
  'tokenomics',
  'rug',
  'pumpDump',
  'p2p',
  'kyc',
  'dca',
  'liquidity',
  'spread',
  'zk',
  'bridge',
  'oracle',
  'slippage',
  'portfolio'
];

export default function Glossary({ onBack }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const terms = useMemo(
    () =>
      TERM_IDS.map((id) => ({
        id,
        en: t(`lab2.screens.glossary.terms.${id}.en`),
        local: t(`lab2.screens.glossary.terms.${id}.local`),
        def: t(`lab2.screens.glossary.terms.${id}.def`)
      })),
    [t]
  );

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return terms;
    return terms.filter(
      (term) =>
        term.en.toLowerCase().includes(q) ||
        term.local.toLowerCase().includes(q) ||
        term.def.toLowerCase().includes(q)
    );
  }, [q, terms]);

  return (
    <div className="lab2-screen">
      <LabBack
        onBack={onBack}
        title={`📖 ${t('lab2.screens.glossary.title')}`}
        sub={t('lab2.screens.glossary.sub')}
      />

      <div className="lab2-glossary-search">
        <input
          className="lab2-glossary-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('lab2.screens.glossary.search')}
          aria-label={t('lab2.screens.glossary.search')}
        />
      </div>

      <Panel title={t('lab2.screens.glossary.count', { count: filtered.length })}>
        <div className="lab2-glossary-list">
          {filtered.length ? (
            filtered.map((term) => (
              <div className="lab2-glossary-item" key={term.id}>
                <div className="lab2-glossary-term">
                  <span className="lab2-glossary-en" dir="ltr">
                    {term.en}
                  </span>
                  {term.local && term.local !== term.en ? (
                    <span className="lab2-glossary-fa">{term.local}</span>
                  ) : null}
                </div>
                <div className="lab2-glossary-def">{term.def}</div>
              </div>
            ))
          ) : (
            <div className="lab2-glossary-empty">{t('lab2.screens.glossary.empty')}</div>
          )}
        </div>
      </Panel>

      <Notice icon="💡">{t('lab2.screens.glossary.note')}</Notice>
    </div>
  );
}
