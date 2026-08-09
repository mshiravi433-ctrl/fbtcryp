import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import { POPULAR_COUNTRIES, flagOf } from '../lib/shopDestinations';

/**
 * COUNTRY PICKER.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS REPLACED A <select> ───────────────────────────────────────────
 * The first version was a native dropdown holding 233 options. The owner's
 * verdict: «انتخاب کشورها حالت کشویی زشته قشنگترش کن».
 *
 * He is right, and it is not only cosmetic. On a phone a 233-item native
 * dropdown is a full-screen scroll of unlabelled text with no search, no
 * flags, and no way to tell Türkiye from Turkmenistan at a glance. Choosing
 * wrong here costs real money — a gift card bought for the wrong country is
 * usually unredeemable — so the control deserves to be good.
 *
 * This is a sheet with a search box, a shortlist of the countries this
 * audience actually buys for, and a flag on every tile. Everything else stays
 * reachable through search, so nothing is lost.
 *
 * Flags are emoji rather than 233 images: sharp at any size, no network, and
 * they degrade to the country's letters instead of a broken-image box.
 */
export default function ShopCountrySheet({ open, onClose, countries, value, onPick }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');

  const { popular, rest } = useMemo(() => {
    const all = Array.isArray(countries) ? countries : [];
    const needle = q.trim().toLowerCase();

    if (needle) {
      /*
       * Searching collapses the two groups into one list. Keeping "popular"
       * pinned during a search would push the actual match below the fold,
       * which is the opposite of what someone typing wants.
       */
      return {
        popular: [],
        rest: all.filter(
          (c) =>
            c.name.toLowerCase().includes(needle) ||
            c.code.toLowerCase().includes(needle)
        )
      };
    }

    const byCode = new Map(all.map((c) => [c.code, c]));
    return {
      popular: POPULAR_COUNTRIES.map((cc) => byCode.get(cc)).filter(Boolean),
      rest: all.filter((c) => !POPULAR_COUNTRIES.includes(c.code))
    };
  }, [countries, q]);

  const tile = (c) => (
    <button
      key={c.code}
      className="cpick"
      data-on={c.code === value}
      onClick={() => {
        onPick(c.code);
        setQ('');
      }}
    >
      <span className="cpick-flag" aria-hidden="true">{flagOf(c.code)}</span>
      <span className="cpick-name">{c.name}</span>
    </button>
  );

  return (
    <Sheet open={open} onClose={onClose} title={t('shop.pickCountry')} size="lg">
      <p className="prose-sm" style={{ marginTop: 0 }}>{t('shop.pickCountryWhy')}</p>

      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('shop.searchCountry')}
        style={{ marginBottom: 12 }}
      />

      {!countries?.length ? (
        <div className="stack" style={{ gap: 9 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel" style={{ height: 74 }} />
          ))}
        </div>
      ) : (
        <>
          {popular.length > 0 && (
            <>
              <p className="section-label">{t('shop.popular')}</p>
              <div className="cpick-grid" style={{ marginBottom: 16 }}>{popular.map(tile)}</div>
              <p className="section-label">{t('shop.allCountries')}</p>
            </>
          )}
          {rest.length === 0 ? (
            <p className="faint">{t('shop.noMatch')}</p>
          ) : (
            <div className="cpick-grid">{rest.map(tile)}</div>
          )}
        </>
      )}
    </Sheet>
  );
}
