import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtCompact, fmtNum, fmtPct, fmtUsd } from '../lib/format';
import { tokenIdentity } from '../lib/tokenIdentity';

/**
 * ─── «دربارهٔ این توکن» — THE PANEL THE COIN SCREEN NEVER HAD ───────────────
 *
 * Four tabs answered "what is its price chart", "how do I trade it", "how does
 * it compare" and "what are wallets doing". None answered "what IS this thing",
 * which is the first question a reader has about a token they have just found
 * — and every number below was ALREADY in the payload this page fetches: `ath`,
 * `athChange`, `atl`, `supply`, `mcap`, `volume`, `description`, `homepage`.
 *
 * ─── CPU: THIS PANEL IS FREE UNTIL IT IS OPEN ──────────────────────────────
 * There is no effect, no interval, no request and no animation in this file.
 * Every value is a pure computation over `coin` and `global` — objects the page
 * already holds — memoised on the two ids it can actually depend on. The tab
 * itself is a `lazyRetry` chunk, so a reader who never opens it never even
 * downloads this module. That is the whole CPU story: the cheapest work is the
 * work that is not scheduled.
 *
 * ─── THE HONESTY RULE ──────────────────────────────────────────────────────
 * Every figure can be null (the CoinLore backup sends no `ath`, no `atl` and no
 * supply), and null renders «—» with a sentence saying the feed omitted it. A
 * zero here would read as a measurement: "0% from its high" is a token at its
 * high, and "0% of supply" is a token with none.
 */
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
  const { t } = useTranslation();

  /*
   * Recomputed only when the identity of the coin or the two market readings
   * change. `coin` is a new object on every 30 s poll, so depending on the
   * object would recompute nine divisions sixty times an hour for numbers that
   * did not move — the same accounting mistake the row comparator exists to
   * avoid, one level up.
   */
  const id = useMemo(
    () => tokenIdentity(coin, { global, bitcoin }),
    [
      coin?.id, coin?.price, coin?.ath, coin?.athChange, coin?.atl, coin?.atlChange,
      coin?.supply, coin?.mcap, coin?.volume, coin?.change24h, coin?.high24h, coin?.low24h,
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
      {coin?.description ? (
        <section className="coin-id-card" aria-labelledby="coin-id-about-title">
          <h3 className="coin-id-title" id="coin-id-about-title">{t('coin.identity.aboutTitle')}</h3>
          <p className="coin-id-copy" data-testid="coin-identity-description">{coin.description}</p>
          <div className="coin-id-links">
            {safeHref(coin.homepage) && (
              <a
                className="coin-id-link"
                href={safeHref(coin.homepage)}
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
              {t('coin.identity.source', { provider: coin.marketProvider === 'coingecko' ? 'CoinGecko' : (coin.marketProvider || '—') })}
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
            hint={coin?.ath ? fmtUsd(coin.ath) : undefined}
            tone={id.drawdown == null ? 'muted' : 'down'}
            testId="coin-identity-drawdown"
          />
          <Metric
            label={t('coin.identity.fromAtl')}
            value={id.rise == null ? dash : fmtPct(id.rise, 2)}
            hint={coin?.atl ? fmtUsd(coin.atl) : undefined}
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
