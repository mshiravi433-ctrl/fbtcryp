/**
 * PANEL 1 — WORLD STATE: the financial weather board.
 * ---------------------------------------------------------------------------
 * REPORTED (2026-10): «ایستگاه‌های آب‌وهوای مالی داده معتبر ندارد و باید با
 * محک درست کالیبره شود».
 *
 * Every market station is now read against the TYPICAL DAILY MOVE of its own
 * market (calibration.js): the card says how many «normal days» the move was,
 * the weather word, the dial and the sentence all come from the same number,
 * and a legend prints the benchmark constants as exactly what they are —
 * model constants, not today's measurement. Each value carries a quality badge
 * (direct read · proxy · level only · last good read) and the provider that
 * supplied it, so a proxy can never pass for the thing it stands in for.
 *
 *   · CLIMATE  — one weighted index of this pass with its components;
 *   · STATIONS — fourteen stations, the six headline measures first;
 *   · the compact strip (views of the same stations), the nine gauges and the
 *     radar ribbon.
 * A station whose input was not read shows «خوانده نشد» and an empty dial.
 */
import { useMemo } from 'react';
import {
  buildClimate, buildWorldState, buildWeather, buildWeatherStations, buildRadar, describeSource,
  STATION_META, CLIMATE_PART_META, TONE_WORD, BENCH, BAND_WORD, summariseStations
} from './worldModel.js';
import { WeatherGlyph, WIcon, DirMark } from './icons.jsx';
import { evidenceLabel, evidenceValue, evidenceText, faNum, pct, usdCompact, usdFaCompact, moneyK } from './format.jsx';
import { QualityBadge, Ltr } from './parts.jsx';

const METRIC_META = {
  liquidity: { fa: 'نقدینگی جهانی', en: 'Global liquidity' },
  risk: { fa: 'ریسک جهانی', en: 'Global risk' },
  inflation: { fa: 'فشار تورم (انرژی)', en: 'Inflation pressure (energy)' },
  dollar: { fa: 'قدرت دلار', en: 'Dollar strength' },
  cryptoFlow: { fa: 'جریان رمزارز', en: 'Crypto flow' },
  institutional: { fa: 'جریان نهادی', en: 'Institutional flow' },
  geopolitics: { fa: 'ریسک ژئوپلیتیک', en: 'Geopolitical risk' },
  rwa: { fa: 'دارایی‌های واقعی (RWA)', en: 'RWA adoption' },
  volatility: { fa: 'نوسان جهانی', en: 'Global volatility' }
};

const LEVEL_META = {
  high: { fa: 'بالا', en: 'HIGH', cls: 'bad' },
  medium: { fa: 'متوسط', en: 'MEDIUM', cls: 'warn' },
  low: { fa: 'پایین', en: 'LOW', cls: 'up' }
};

const GAUGE_ICON = {
  liquidity: 'drop', risk: 'warning', inflation: 'flame', dollar: 'bank', cryptoFlow: 'coin',
  institutional: 'building', geopolitics: 'globe', rwa: 'layers', volatility: 'pulse'
};

const WEATHER_ICON = { sun: 'sun', partly: 'partly', cloud: 'cloud', rain: 'rain', storm: 'storm', wind: 'wind', windy: 'wind', wavesIcon: 'waves', newsIcon: 'news', na: 'na' };
const WEATHER_META = {
  liquidity: { fa: 'آسمان نقدینگی', en: 'Liquidity sky' },
  volatility: { fa: 'تلاطم', en: 'Volatility' },
  whales: { fa: 'فعالیت نهنگ‌ها', en: 'Whale activity' },
  macro: { fa: 'ریسک کلان', en: 'Macro risk' },
  chains: { fa: 'افق زنجیره‌ها', en: 'Chain horizon' },
  dollarWind: { fa: 'باد دلار', en: 'Dollar wind' },
  news: { fa: 'دمای خبر', en: 'News temperature' }
};

/** the six headline measures: smart money, dollar, gold, bonds, oil/inflation, risk */
const FEATURED = new Set(['institutional', 'dollar', 'gold', 'bonds', 'inflation', 'risk']);

/** the benchmark rows the legend prints (the markets the stations are scored against) */
const LEGEND_MARKETS = ['dollar', 'gold', 'oil', 'bonds', 'equity', 'crypto'];

function BenchLegend({ L, isPersian }) {
  const sigmaText = (b) => {
    const v = isPersian ? faNum(b.sigma) : String(b.sigma);
    return b.unit === 'bp' ? `${v} ${isPersian ? 'واحد پایه' : 'bp'}` : `${v}${isPersian ? '\u066a' : '%'}`;
  };
  return (
    <details className="aigw-bench">
      <summary>
        <WIcon name="target" size={15} />
        <span>{L('محک: چرا این رنگ؟ چرا این عدد؟', 'Benchmark: why this colour, why this number?')}</span>
        <i className="aigw-bench-caret" aria-hidden="true" />
      </summary>
      <div className="aigw-bench-body">
        <p>
          {L(
            'هر ایستگاه با «روز معمول» همان بازار سنجیده می‌شود: حرکت امروز تقسیم بر نوسان معمول روزانه. «۱٫۰ برابر» یعنی حرکتی کاملاً معمول؛ «۲٫۵ برابر» یعنی روزی حدی.',
            'Each station is scored against its own market\u2019s normal day: today\u2019s move divided by the typical daily swing. «1.0×» is a perfectly ordinary move; «2.5×» is an extreme day.'
          )}
        </p>
        <div className="aigw-bench-bands">
          {['calm', 'normal', 'strong', 'extreme'].map((k, i) => (
            <span key={k} className={`aigw-band b-${k}`}>
              <b>{isPersian ? BAND_WORD[k].fa : BAND_WORD[k].en}</b>
              <small>{['<0.5', '<1.5', '<2.5', '≥2.5'].map((t) => (isPersian ? faNum(t) : t))[i]}{isPersian ? ' برابر' : '×'}</small>
            </span>
          ))}
        </div>
        <div className="aigw-bench-table" role="table" aria-label={L('نوسان معمول روزانه', 'typical daily move')}>
          {LEGEND_MARKETS.map((k) => (
            <div key={k} className="aigw-bench-row" role="row">
              <span role="cell">{isPersian ? BENCH[k].fa : BENCH[k].en}</span>
              <Ltr>{sigmaText(BENCH[k])}</Ltr>
            </div>
          ))}
        </div>
        <p className="aigw-bench-note">
          {L(
            'این اعداد ثابت‌های مدل‌اند (نوسان معمولِ بلندمدت هر بازار)، نه اندازه‌گیری امروز. ایستگاهِ «پروکسی» یعنی عدد از جایگزین معتبری گرفته شده و برچسب دارد؛ «فقط سطح» یعنی قیمت رسید ولی تغییر روزانه نه.',
            'These are model constants (each market\u2019s long-run normal swing), not today\u2019s measurement. A «proxy» station took its number from a labelled stand-in; «level only» means a price arrived but no daily change.'
          )}
        </p>
      </div>
    </details>
  );
}

export function WorldStatePanel({ world, L, isPersian, onGoTab }) {
  const climate = useMemo(() => buildClimate(world), [world]);
  const stations = useMemo(() => buildWeatherStations(world), [world]);
  const summary = useMemo(() => summariseStations(stations), [stations]);
  const model = useMemo(() => buildWorldState(world), [world]);
  const hourly = useMemo(() => buildWeather(world), [world]);
  const radar = useMemo(() => buildRadar(world), [world]);

  const toneWord = (tone) => (isPersian ? TONE_WORD[tone]?.fa : TONE_WORD[tone]?.en) || '—';
  const climateTone = climate.label || 'na';
  const climateWord = climate.label
    ? (isPersian ? TONE_WORD[climate.label].fa : TONE_WORD[climate.label].en)
    : L('خوانده نشد', 'not read');

  /* the gauge evidence keeps the exact vocabulary the screen always printed */
  const evText = (m) => evidenceText(m.evidence, isPersian);

  return (
    <div className="aigw-panel acc-weather">
      {/* ── the climate of this pass ─────────────────────────────────────── */}
      <div className="aigw-climate">
        <div className="aigw-climate-main">
          <WeatherGlyph name={WEATHER_ICON[climateTone] || 'na'} size={62} />
          <div className="aigw-climate-copy">
            <div className="aigw-climate-kicker">{L('اقلیم مالی این دور', 'This pass\u2019s financial climate')}</div>
            <div className="aigw-climate-label">{climateWord}</div>
            <div className="aigw-climate-sub">
              {climate.label
                ? L(
                  `ترکیب وزن‌دار ${faNum(climate.readCount)} خوانش واقعی از ${faNum(climate.total)} جزء ممکن`,
                  `weighted composite of ${climate.readCount} real reads of ${climate.total} possible components`
                )
                : L('برای این دور به‌اندازهٔ کافی خوانش نبود — هیچ عددی حدس زده نمی‌شود.', 'Too few readings this pass — nothing is guessed.')}
            </div>
          </div>
          <div className="aigw-climate-index">
            <b>{climate.index === null ? '—' : (isPersian ? faNum(climate.index) : climate.index)}</b>
            <span>{L('از ۱۰۰', '/ 100')}</span>
          </div>
        </div>

        {climate.index !== null ? (
          <div className="aigw-climate-bar" aria-hidden="true">
            <i style={{ insetInlineStart: `calc(${climate.index}% - 1.5px)` }} />
          </div>
        ) : null}

        <div className="aigw-climate-parts">
          {climate.components.length ? climate.components.map((c) => (
            <span key={c.id} className="aigw-tag" title={isPersian ? c.evidenceFa || '' : c.evidence || ''}>
              {isPersian ? CLIMATE_PART_META[c.id]?.fa || c.id : CLIMATE_PART_META[c.id]?.en || c.id}
              <b className="aigw-ltr">{c.contribution > 0 ? '+' : ''}{isPersian ? faNum(c.contribution) : c.contribution}</b>
            </span>
          )) : (
            <span className="aigw-tag">{L('هیچ جزئی خوانده نشد', 'no component read')}</span>
          )}
          <span className="aigw-tag" title={L('درصد وزنِ اجزایی که در این دور خوانده شدند', 'share of the component weight that was read this pass')}>
            {L('پوشش وزن', 'weight coverage')} <b className="aigw-ltr">{isPersian ? faNum(Math.round((climate.coverage || 0) * 100)) : Math.round((climate.coverage || 0) * 100)}{isPersian ? '\u066a' : '%'}</b>
          </span>
        </div>
        {climate.components.length ? (
          <div className="aigw-climate-cap">
            {L(
              'عدد کنار هر جزء، سهم آن در شاخص اقلیم است؛ منفی یعنی فشار و مثبت یعنی حمایت.',
              'The figure beside each part is its contribution to the climate index; negative means pressure, positive means support.'
            )}
          </div>
        ) : null}
      </div>

      {/* ── the station board ────────────────────────────────────────────── */}
      <div className="aigw-sec">
        <WIcon name="gauge" size={17} />
        {L('ایستگاه‌های آب‌وهوای مالی', 'Financial weather stations')}
        <span className="aigw-sec-sub">
          {isPersian ? `${faNum(summary.valid)} از ${faNum(summary.total)} معتبر` : `${summary.valid} of ${summary.total} valid`}
        </span>
      </div>

      <div className="aigw-stations-sum" role="status">
        <span className="aigw-sum-chip s-measured"><i />{L('خوانش مستقیم', 'direct')} <b>{isPersian ? faNum(summary.measured) : summary.measured}</b></span>
        <span className="aigw-sum-chip s-proxy"><i />{L('پروکسی', 'proxy')} <b>{isPersian ? faNum(summary.proxy) : summary.proxy}</b></span>
        <span className="aigw-sum-chip s-level"><i />{L('فقط سطح', 'level only')} <b>{isPersian ? faNum(summary.level) : summary.level}</b></span>
        <span className="aigw-sum-chip s-unread"><i />{L('خوانده نشد', 'unread')} <b>{isPersian ? faNum(summary.unread) : summary.unread}</b></span>
      </div>

      <BenchLegend L={L} isPersian={isPersian} />

      <div className="aigw-stations">
        {stations.map((s) => {
          const value = isPersian ? s.valueTextFa : s.valueText;
          const feature = FEATURED.has(s.id);
          const chips = (s.evidence || []).filter((e) => e && e.value !== null && e.value !== undefined).slice(0, 3);
          return (
            <div key={s.id} className={`aigw-station tone-${s.tone} q-${s.quality || 'none'} ${feature ? 'feature' : ''}`}>
              <div className="aigw-station-top">
                <div style={{ minWidth: 0 }}>
                  <div className="aigw-station-name">{isPersian ? STATION_META[s.id]?.fa : STATION_META[s.id]?.en}</div>
                  <div className="aigw-station-cond">
                    {toneWord(s.tone)}
                    {s.band ? <span className={`aigw-band-dot b-${s.band}`}>{isPersian ? BAND_WORD[s.band].fa : BAND_WORD[s.band].en}</span> : null}
                  </div>
                </div>
                <WeatherGlyph name={s.icon} size={feature ? 48 : 38} />
              </div>
              <div className="aigw-station-val">
                {/* the honesty rule of the board: a station with no reading says
                    «خوانده نشد» — a bare dash reads like a zero to a user */}
                {value
                  ? <><Ltr>{value}</Ltr>{(isPersian ? s.unitFa : s.unitEn) ? <small>{isPersian ? s.unitFa : s.unitEn}</small> : null}</>
                  : <span className="aigw-station-unread">{L('خوانده نشد', 'unread')}</span>}
              </div>
              {s.quality || s.readFa ? (
                <div className="aigw-station-meta">
                  <QualityBadge quality={s.quality} isPersian={isPersian} />
                  {s.readFa ? <span className="aigw-station-read">{isPersian ? s.readFa : s.readEn}</span> : null}
                </div>
              ) : null}
              <div className="aigw-dial" aria-hidden="true">
                <i style={{ width: `${Math.round((s.severity || 0) * 100)}%` }} />
              </div>
              <div className="aigw-station-ev">
                {chips.length
                  ? chips.map((e, i) => (
                    <span key={`${e.key}-${i}`} className="aigw-ev">
                      <span>{evidenceLabel(e.key, isPersian)}</span>
                      <Ltr>{isPersian && e.valueFa !== undefined ? e.valueFa : evidenceValue(e.key, e.value, isPersian)}</Ltr>
                    </span>
                  ))
                  : L('در این دور خوانده نشد', 'not read in this pass')}
              </div>
              {(isPersian ? s.basisFa : s.basisEn) ? (
                <div className="aigw-station-basis">{isPersian ? s.basisFa : s.basisEn}</div>
              ) : null}
              {(isPersian ? s.noteFa : s.noteEn) && !(isPersian ? s.basisFa : s.basisEn) ? (
                <div className="aigw-station-basis">{isPersian ? s.noteFa : s.noteEn}</div>
              ) : null}
              {s.source ? (
                <div className="aigw-station-src">{L('منبع', 'source')}: <b>{describeSource(s.source, isPersian)}</b></div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* ── the compact strip (views of the same stations) ────────────────── */}
      <div className="aigw-sec" style={{ marginTop: 16 }}>
        <WIcon name="clock" size={17} />
        {L('نوار خلاصه', 'Summary strip')}
        <span className="aigw-sec-sub">{L('نمای کوتاه همین ایستگاه‌ها', 'a short view of the same stations')}</span>
      </div>
      <div className="aigw-weather" role="list" aria-label={L('آب‌وهوای مالی', 'Financial weather')}>
        {hourly.map((w) => (
          <div key={w.id} className={`aigw-weather-card tone-${w.tone}`} role="listitem">
            <span className="aigw-weather-icon"><WeatherGlyph name={WEATHER_ICON[w.icon] || 'cloud'} size={30} /></span>
            <div className="aigw-weather-name">{isPersian ? WEATHER_META[w.id]?.fa : WEATHER_META[w.id]?.en}</div>
            <div className="aigw-weather-val">
              {(isPersian ? w.valueTextFa : w.valueText) || '—'}
            </div>
          </div>
        ))}
      </div>

      {/* ── the nine world-state gauges ──────────────────────────────────── */}
      <div className="aigw-sec">
        <WIcon name="signal" size={17} />
        {L('وضعیت جهان مالی', 'Global financial state')}
        <span className="aigw-sec-sub">{isPersian ? `${faNum(model.okCount)}/${faNum(model.total)} خوانده شد` : `${model.okCount}/${model.total} read`}</span>
      </div>

      <div className="aigw-gauges">
        {model.metrics.map((m) => {
          const meta = METRIC_META[m.id] || { fa: m.id, en: m.id };
          const lit = Math.max(m.status === 'ok' ? 1 : 0, Math.round(m.meter * 5));
          const bad = m.id === 'risk' || m.id === 'volatility' || m.id === 'geopolitics';
          return (
            <div key={m.id} className="aigw-gauge">
              <span className="aigw-gauge-icon"><WIcon name={GAUGE_ICON[m.id] || 'pulse'} size={18} /></span>
              <div style={{ minWidth: 0 }}>
                <div className="aigw-gauge-name">{isPersian ? meta.fa : meta.en}</div>
                <div className="aigw-gauge-ev">
                  {m.status === 'ok' ? (evText(m) || L('از خوانش همین دور', 'from this pass')) : L('در این دور خوانده نشد', 'not read in this pass')}
                  {m.proxy && m.status === 'ok' ? ` · ${L('پروکسی', 'proxy')}` : ''}
                </div>
              </div>
              <div className="aigw-gauge-side">
                {m.kind === 'dir' ? (
                  <span className={`aigw-pill ${m.status !== 'ok' ? 'ghost' : m.dir === 'up' ? 'up' : m.dir === 'down' ? 'down' : 'flat'}`}>
                    {m.status === 'ok' ? <DirMark dir={m.dir} size={9} /> : null}
                    {m.status !== 'ok' ? '—'
                      : m.valuePct !== null && m.valuePct !== undefined ? pct(m.valuePct, isPersian)
                        : m.valueUsd !== null && m.valueUsd !== undefined ? (isPersian ? usdFaCompact(m.valueUsd, { signed: false }) : usdCompact(m.valueUsd).replace('+', ''))
                          : m.dir === 'up' ? L('صعودی', 'rising') : m.dir === 'down' ? L('نزولی', 'falling') : L('خنثی', 'flat')}
                  </span>
                ) : (
                  <span className={`aigw-pill ${m.status !== 'ok' ? 'ghost' : LEVEL_META[m.level]?.cls || 'flat'}`}>
                    {m.status !== 'ok' ? '—' : isPersian ? LEVEL_META[m.level]?.fa : LEVEL_META[m.level]?.en}
                  </span>
                )}
                <span className="aigw-gauge-meter" aria-hidden="true">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <i key={i} className={`${i < lit ? 'on' : ''} ${bad ? 'bad' : ''}`} />
                  ))}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── the radar ribbon ─────────────────────────────────────────────── */}
      <button type="button" className="aigw-ribbon" onClick={() => onGoTab && onGoTab('radar')}>
        <WIcon name="radar" size={18} style={{ color: 'var(--acc1)' }} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: 11.5, fontWeight: 900, color: 'var(--text-1)' }}>{L('رادار جهانی', 'Global Radar')}</span>
          <span style={{ display: 'block', fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
            {L('هر سیگنال این دور با ارزش واقعی‌اش — برای نقشهٔ کامل لمس کن', 'every signal of this pass with its real value — tap for the full map')}
          </span>
        </span>
        <span className="aigw-ribbon-dots">
          {['critical', 'emerging', 'developing', 'stable', 'opportunity'].map((t) => (
            radar.counts[t] ? <b key={t}><span className={`aigw-dot t-${t}`} />{isPersian ? faNum(radar.counts[t]) : radar.counts[t]}</b> : null
          ))}
        </span>
      </button>

      <div className="aigw-note">
        {L(
          'هر جهت، سطح و دمای این صفحه از یک خوانش واقعی همین دور آمده و شواهدش کنارش نوشته شده است؛ «پروکسی» یعنی جایگزین برچسب‌دار، و «خوانده نشد» یعنی دادهٔ معتبری نرسید — هیچ عددی ساخته نمی‌شود. شاخص اقلیم یک ترکیب مدل است، نه پیش‌بینی.',
          'Every direction, level and temperature here comes from a real reading of this pass with its evidence beside it; «proxy» means a labelled stand-in and «unread» means no valid data arrived — no number is made up. The climate index is a model blend, not a forecast.'
        )}
      </div>
    </div>
  );
}

export default WorldStatePanel;

/* kept for callers that still import the old money helper */
export { moneyK };
