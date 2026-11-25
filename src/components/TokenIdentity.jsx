import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtCompact, fmtNum, fmtPct, fmtUsd } from '../lib/format';
import { tokenIdentity } from '../lib/tokenIdentity';

/** Identity is loaded lazily, with one optional profile request per visit.
 * Missing fields remain missing rather than being presented as zero. */
/**
 * A homepage is a link to somewhere we do not control, taken from a public API.
 * `target="_blank"` + `noopener` protects the tab; it says nothing about the
 * SCHEME. A feed entry of `javascript:…` would become a live script in the
 * user's page on click, so only http(s) is allowed through and anything else
 * (including `data:` and a bare junk string) renders no link at all.
 */
function safeHref(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function Metric({ label, value, hint, tone, testId, dataCapped }) {
  return (
    <div
      className="coin-id-metric"
      data-tone={tone ?? 'neutral'}
      data-capped={dataCapped}
      data-testid={testId}
    >
      <span className="coin-id-metric-label">{label}</span>
      <span className="coin-id-metric-value mono">{value}</span>
      {hint && <span className="coin-id-metric-hint">{hint}</span>}
    </div>
  );
}

/** A labelled 0..1 track. Static: the marker is placed once, never animated. */
function Track({ value, label, caption, testId }) {
  if (value == null) return null;
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div className="coin-id-track" data-testid={testId}>
      <div className="coin-id-track-head">
        <span className="coin-id-track-label">{label}</span>
        <span className="coin-id-track-caption mono">{caption}</span>
      </div>
      <span className="coin-id-track-rail" aria-hidden="true">
        <i style={{ insetInlineStart: `${pct.toFixed(1)}%` }} />
      </span>
    </div>
  );
}

export default function TokenIdentity({ coin, global = null, bitcoin = null }) {
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    if (!coin?.id) return undefined;
    const controller = new AbortController();
    setProfile(null);
    // The lightweight market endpoint does not include project descriptions.
    // Fetch them only while the identity tab is open; failures leave market data intact.
    fetch(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coin.id)}?localization=true&tickers=false&market_data=true&community_data=false&developer_data=false`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('profile unavailable'); return response.json(); })
      .then((raw) => {
        const md = raw.market_data || {};
        setProfile({ id: raw.id, descriptions: raw.description || {}, homepage: raw.links?.homepage?.find(Boolean),
          maxSupply: md.max_supply, totalSupply: md.total_supply, supply: md.circulating_supply,
          ath: md.ath?.usd, atl: md.atl?.usd, athChange: md.ath_change_percentage?.usd,
          atlChange: md.atl_change_percentage?.usd });
      }).catch(() => {});
    return () => controller.abort();
  }, [coin?.id]);
  const detail = profile?.id === coin?.id ? profile : null;
  // Do not let an absent profile field erase a valid market reading.
  const enrichedCoin = useMemo(() => {
    const merged = { ...coin };
    if (detail) for (const [key, value] of Object.entries(detail)) {
      if (value != null && key !== 'descriptions') merged[key] = value;
    }
    return merged;
  }, [coin, detail]);
  const language = (i18n?.resolvedLanguage || i18n?.language || 'en').split('-')[0];
  const localized = detail?.descriptions?.[language];
  const descriptionLanguage = localized ? language : 'en';
  const rawDescription = localized || detail?.descriptions?.en || coin?.description || '';
  const description = useMemo(() => {
    if (!rawDescription) return '';
    if (typeof DOMParser === 'undefined') return rawDescription;
    const doc = new DOMParser().parseFromString(rawDescription, 'text/html');
    doc.querySelectorAll('script, style').forEach((node) => node.remove());
    return doc.body.textContent.trim();
  }, [rawDescription]);

  const id = useMemo(
    () => tokenIdentity(enrichedCoin, { global, bitcoin }),
    [
      enrichedCoin,
      global?.mcap, global?.avgChange, bitcoin?.change24h
    ]
  );

  const dash = t('coin.identity.unavailable');
  const { supply } = id;

  const dayPct = id.dayPosition;

  return (
    <div className="coin-identity" data-testid="coin-identity">
      {/*
        ─── 1 · WHAT IT IS ────────────────────────────────────────────────────
        The publisher's own description, clamped to a readable length with the
        full text a tap away. This is the only prose on the page, and it is the
        only thing here that answers "what is this token" in words rather than
        arithmetic.
      */}
      <header className="coin-id-hero">
        <span className="coin-id-eyebrow">{t('coin.identity.identity')}</span>
        <h3>{coin?.name} <span>{coin?.symbol}</span></h3>
        <p className="coin-id-typing">{t('coin.identity.snapshot', { name: coin?.name || coin?.symbol || '—' })}</p>
        <div className="coin-id-hero-stats">
          <span>{t('coin.identity.circulating')} <b>{supply.circulating == null ? dash : fmtCompact(supply.circulating)}</b></span>
          <span>{t('coin.identity.fromAth')} <b>{id.drawdown == null ? dash : fmtPct(-id.drawdown, 2)}</b></span>
          <span>{t('coin.identity.turnover')} <b>{id.turnover == null ? dash : fmtPct(id.turnover * 100, 1)}</b></span>
        </div>
      </header>
      {description ? (
        <section className="coin-id-card" aria-labelledby="coin-id-about-title">
          <h3 className="coin-id-title" id="coin-id-about-title">{t('coin.identity.aboutTitle')}</h3>
          <details className="coin-id-description" open>
            <summary>{t('coin.identity.readDescription')}</summary>
            {descriptionLanguage !== language && <p className="coin-id-note">{t('coin.identity.originalEnglish')}</p>}
            <p className="coin-id-copy" lang={descriptionLanguage} dir="auto" data-testid="coin-identity-description">{description}</p>
          </details>
          <div className="coin-id-links">
            {safeHref(enrichedCoin.homepage) && (
              <a
                className="coin-id-link"
                href={safeHref(enrichedCoin.homepage)}
                target="_blank"
                rel="noopener noreferrer nofollow"
                data-testid="coin-identity-homepage"
              >
                {t('coin.identity.officialSite')}
              </a>
            )}
            {/* Where the numbers come from, said out loud — a reader is entitled
                to know whether they are looking at CoinGecko or the backup. */}
            <span className="coin-id-source" data-testid="coin-identity-source">
              {t('coin.identity.source', { provider: detail ? 'CoinGecko' : (coin.marketProvider === 'coingecko' ? 'CoinGecko' : (coin.marketProvider || '—')) })}
            </span>
          </div>
        </section>
      ) : (
        <section className="coin-id-card">
          <h3 className="coin-id-title">{t('coin.identity.aboutTitle')}</h3>
          <p className="coin-id-note" data-testid="coin-identity-no-description">
            {t('coin.identity.noDescription')}
          </p>
        </section>
      )}

      {/*
        ─── 2 · ITS WHOLE HISTORY, IN TWO NUMBERS ─────────────────────────────
        How far it has fallen from its high and risen from its low. A chart
        shows the last day; these two say where the current price sits in the
        token's entire life, which is what makes a 90% drawdown legible as a
        fact rather than a frightening word.
      */}
      <section className="coin-id-card" aria-labelledby="coin-id-history-title">
        <h3 className="coin-id-title" id="coin-id-history-title">{t('coin.identity.historyTitle')}</h3>
        <div className="coin-id-grid">
          <Metric
            label={t('coin.identity.fromAth')}
            value={id.drawdown == null ? dash : fmtPct(-id.drawdown, 2)}
            hint={enrichedCoin?.ath ? fmtUsd(enrichedCoin.ath) : undefined}
            tone={id.drawdown == null ? 'muted' : 'down'}
            testId="coin-identity-drawdown"
          />
          <Metric
            label={t('coin.identity.fromAtl')}
            value={id.rise == null ? dash : fmtPct(id.rise, 2)}
            hint={enrichedCoin?.atl ? fmtUsd(enrichedCoin.atl) : undefined}
            tone={id.rise == null ? 'muted' : 'up'}
            testId="coin-identity-rise"
          />
          <Metric
            label={t('coin.identity.dayLow')}
            value={coin?.low24h ? fmtUsd(coin.low24h) : dash}
            testId="coin-identity-low"
          />
          <Metric
            label={t('coin.identity.dayHigh')}
            value={coin?.high24h ? fmtUsd(coin.high24h) : dash}
            testId="coin-identity-high"
          />
        </div>

        {/* Where the price sits in today's range, stated as a sentence as well
            as a track — a bar alone makes a reader estimate a number that the
            data already knows. */}
        {id.dayPosition != null && (
          <Track
            value={id.dayPosition}
            label={t('coin.identity.dayPosition')}
            caption={t('coin.identity.dayPositionValue', { pct: fmtNum(Math.round(dayPct * 100)) })}
            testId="coin-identity-day-position"
          />
        )}
      </section>

      {/*
        ─── 3 · SUPPLY, AND WHAT KIND OF SUPPLY IT IS ─────────────────────────
        "Is there a cap" is a different fact from "how much is circulating", and
        a token with no maximum supply is UNCAPPED — not 0% unlocked. The panel
        says which one it is looking at instead of drawing an empty bar.
      */}
      <section className="coin-id-card" aria-labelledby="coin-id-supply-title">
        <h3 className="coin-id-title" id="coin-id-supply-title">{t('coin.identity.supplyTitle')}</h3>
        <div className="coin-id-grid">
          <Metric
            label={t('coin.identity.circulating')}
            value={supply.circulating == null ? dash : fmtCompact(supply.circulating)}
            testId="coin-identity-circulating"
          />
          <Metric
            label={t('coin.identity.maxSupply')}
            /* Three states, three different words. `capped === null` means the
               feed never sent the field, so the ceiling is unknown — printing
               «بدون سقف» there would assert a fact the payload did not carry. */
            value={
              supply.capped === true
                ? fmtCompact(supply.max)
                : supply.capped === false
                  ? t('coin.identity.uncapped')
                  : dash
            }
            tone={supply.capped === true ? 'neutral' : 'muted'}
            testId="coin-identity-max-supply"
            dataCapped={supply.capped === null ? 'unknown' : String(supply.capped)}
          />
          <Metric
            label={t('coin.identity.turnover')}
            value={id.turnover == null ? dash : fmtPct(id.turnover * 100, 1)}
            hint={t('coin.identity.turnoverHint')}
            testId="coin-identity-turnover"
          />
          <Metric
            label={t('coin.identity.marketShare')}
            value={id.share == null ? dash : `${id.share.toFixed(id.share < 1 ? 2 : 1)}%`}
            testId="coin-identity-share"
          />
        </div>

        {/* Only drawn when there IS a cap: an "unlocked" track for an uncapped
            token would be a bar with no possible value. */}
        {supply.unlocked != null && (
          <Track
            value={supply.unlocked}
            label={t('coin.identity.unlocked')}
            caption={t('coin.identity.unlockedValue', { pct: fmtNum(Math.round(supply.unlocked * 100)) })}
            testId="coin-identity-unlocked"
          />
        )}
      </section>

      {/*
        ─── 4 · WHAT THE WIDER MARKET DOES TO IT ──────────────────────────────
        Not a story: a co-movement. Did it move with the market or against it
        over 24 h, by how much relative to it, and did it beat Bitcoin. The
        ratio is labelled «دامنهٔ نوسان نسبت به بازار» and never "beta", because
        a beta needs a return series and this screen has three readings.
      */}
      <section className="coin-id-card" aria-labelledby="coin-id-global-title">
        <h3 className="coin-id-title" id="coin-id-global-title">{t('coin.identity.globalTitle')}</h3>
        <p className="coin-id-note">{t('coin.identity.globalNote')}</p>
        <div className="coin-id-grid">
          <Metric
            label={t('coin.identity.marketMove')}
            value={global?.avgChange == null ? dash : fmtPct(global.avgChange, 2)}
            testId="coin-identity-market-move"
          />
          <Metric
            label={t('coin.identity.tokenMove')}
            value={coin?.change24h == null ? dash : fmtPct(coin.change24h, 2)}
            tone={(coin?.change24h ?? 0) >= 0 ? 'up' : 'down'}
            testId="coin-identity-token-move"
          />
          <Metric
            label={t('coin.identity.agreement')}
            value={id.agreement == null
              ? dash
              : t(`coin.identity.agreement_${id.agreement}`)}
            tone={id.agreement === 'against' ? 'down' : id.agreement === 'with' ? 'up' : 'muted'}
            testId="coin-identity-agreement"
          />
          <Metric
            label={t('coin.identity.amplification')}
            value={id.amplification == null ? dash : `${id.amplification >= 0 ? '' : '−'}${Math.abs(id.amplification).toFixed(1)}×`}
            testId="coin-identity-amplification"
          />
          <Metric
            label={t('coin.identity.versusBtc')}
            value={id.versusBtc == null ? dash : `${id.versusBtc >= 0 ? '+' : '−'}${Math.abs(id.versusBtc).toFixed(2)}`}
            hint={t('coin.identity.versusBtcHint')}
            tone={id.versusBtc == null ? 'muted' : id.versusBtc >= 0 ? 'up' : 'down'}
            testId="coin-identity-vs-btc"
          />
        </div>
      </section>

      {/* The reason for every dash, in one sentence — and only when there is one. */}
      {id.missing.length > 0 && (
        <p className="coin-id-note coin-id-missing" data-testid="coin-identity-missing">
          {t('coin.identity.missingData')}
        </p>
      )}
    </div>
  );
}
