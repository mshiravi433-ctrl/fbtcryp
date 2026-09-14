/**
 * Glossary — crypto vocabulary for the Lab Learn group.
 *
 * Definitions live in i18n (`lab2.screens.glossary.terms.*`), not in this
 * file. Hard-coding Persian here is why changing the app language left the
 * whole screen in Farsi.
 *
 * VISUAL PASS: a real search field (icon inside, focus ring in the accent),
 * monogram tiles for each term, and a staggered reveal so a 40-item list
 * arrives as a cascade instead of a wall. Accents rotate through the palette
 * per item — a shelf of identical grey cards is why glossaries feel dead.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Empty, LAB_EASE, LabBack, Notice, Panel, SearchInput } from './Shared';
import { useStill } from '../AnimatedIcon';

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

const ACCENTS = ['cyan', 'violet', 'magenta', 'mint', 'amber'];

export default function Glossary({ onBack }) {
  const { t } = useTranslation();
  const still = useStill();
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
        icon="book"
        accent="violet"
        title={t('lab2.screens.glossary.title')}
        sub={t('lab2.screens.glossary.sub')}
      />

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={t('lab2.screens.glossary.search')}
      />

      <Panel title={t('lab2.screens.glossary.count', { count: filtered.length })} icon="search" accent="violet">
        <div className="lab2-glossary-list">
          {filtered.length ? (
            filtered.map((term, i) => (
              <motion.div
                className={`lab2-glossary-item acc-${ACCENTS[i % ACCENTS.length]}`}
                key={term.id}
                initial={still ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.34, ease: LAB_EASE, delay: still ? 0 : Math.min(i * 0.028, 0.35) }}
              >
                <div className="lab2-glossary-term">
                  <span className="lab2-glossary-en" dir="ltr">
                    <span className="lab2-monogram" aria-hidden="true">
                      {term.en.slice(0, 1).toUpperCase()}
                    </span>
                    {term.en}
                  </span>
                  {term.local && term.local !== term.en ? (
                    <span className="lab2-glossary-fa">{term.local}</span>
                  ) : null}
                </div>
                <div className="lab2-glossary-def">{term.def}</div>
              </motion.div>
            ))
          ) : (
            <Empty icon="search">{t('lab2.screens.glossary.empty')}</Empty>
          )}
        </div>
      </Panel>

      <Notice variant="tip" icon="bulb">{t('lab2.screens.glossary.note')}</Notice>
    </div>
  );
}
