/**
 * PANEL 1 — FBT WORLD STATE: the financial weather board.
 * ---------------------------------------------------------------------------
 * REPORTED: «وضعیت جهان مالی — یک صفحهٔ مدرن از داده‌ها با آیکون‌های جذاب مثل
 * یک صفحهٔ هواشناسی با انیمیشن خیلی جذاب… جریان نهادی، قدرت دلار، فشار تورم
 * (انرژی)، ریسک جهانی».
 *
 * The board is a weather station, and every reading on it is real:
 *   · CLIMATE  — one weighted index of this pass, with its components listed;
 *   · STATIONS — the four headline measures first (institutional flow, dollar
 *                strength, energy/inflation pressure, global risk), then the
 *                rest of the board — each with an animated glyph, a dial and
 *                the evidence rows that produced it;
 *   · the hourly strip, the nine gauges and the radar ribbon.
 * A station whose input was not read shows «خوانده نشد» and an empty dial.
 */
import { useMemo } from 'react';
import {
  buildClimate, buildWorldState, buildWeather, buildWeatherStations, buildRadar,
  STATION_META, CLIMATE_PART_META, TONE_WORD
} from './worldModel.js';
import { WeatherGlyph, WIcon, DirMark } from './icons.jsx';
import { evidenceText, faNum, pct, usdCompact, moneyK } from './format.jsx';

const METRIC_META = {
  liquidity: { fa: 'نقدینگی جهانی', en: 'Global liquidity' },
  risk: { fa: 'ریسک جهانی', en: 'Global risk' },
  inflation: { fa: 'فشار تورم (انرژی)', en: 'Inflation pressure (energy)' },
  dollar: { fa: 'قدرت دلار', en: 'Dollar strength' },
  cryptoFlow: { fa: 'جریان رمزارز', en: 'Crypto flow' },
  institutional: { fa: 'جریان نهادی', en: 'Institutional flow' },
  geopolitics: { fa: 'ریسک ژئوپلیتیک', en: 'Geopolitical risk' },
  rwa: { fa: 'پذیرش RWA', en: 'RWA adoption' },
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
  macro: { fa: 'باد کلان', en: 'Macro wind' },
  chains: { fa: 'افق زنجیره‌ها', en: 'Chain horizon' },
  dollarWind: { fa: 'باد دلار', en: 'Dollar wind' },
  news: { fa: 'دمای خبر', en: 'News temperature' }
};

/** The four measures the product asked to lead with. */
const FEATURED = new Set(['institutional', 'dollar', 'inflation', 'risk']);

export function WorldStatePanel({ world, L, isPersian, onGoTab }) {
  const climate = useMemo(() => buildClimate(world), [world]);
  const stations = useMemo(() => buildWeatherStations(world), [world]);
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
            <span>/۱۰۰</span>
          </div>
        </div>

        {climate.index !== null ? (
          <div className="aigw-climate-bar" aria-hidden="true">
            <i style={{ insetInlineStart: `calc(${climate.index}% - 1.5px)` }} />
          </div>
        ) : null}

        <div className="aigw-climate-parts">
          {climate.components.length ? climate.components.map((c) => (
            <span key={c.id} className={`aigw-tag`} title={isPersian ? c.evidenceFa || '' : c.evidence || ''}>
              {isPersian ? CLIMATE_PART_META[c.id]?.fa || c.id : CLIMATE_PART_META[c.id]?.en || c.id}
              <b className="aigw-ltr">{c.contribution > 0 ? '+' : ''}{c.contribution}</b>
            </span>
          )) : (
            <span className="aigw-tag">{L('هیچ جزئی خوانده نشد', 'no component read')}</span>
          )}
          <span className="aigw-tag">
            {L('پوشش وزن', 'weight coverage')} <b className="aigw-ltr">{Math.round((climate.coverage || 0) * 100)}%</b>
          </span>
        </div>
      </div>

      {/* ── the station board ────────────────────────────────────────────── */}
      <div className="aigw-sec">
        <WIcon name="gauge" size={17} />
        {L('ایستگاه‌های آب‌وهوای مالی', 'Financial weather stations')}
        <span className="aigw-sec-sub">{L('خوانش واقعی همین دور', 'real reads of this pass')}</span>
      </div>

      <div className="aigw-stations">
        {stations.map((s) => (
          <div key={s.id} className={`aigw-station tone-${s.tone} ${FEATURED.has(s.id) ? 'feature' : ''}`}>
            <div className="aigw-station-top">
              <div style={{ minWidth: 0 }}>
                <div className="aigw-station-name">{isPersian ? STATION_META[s.id]?.fa : STATION_META[s.id]?.en}</div>
                <div className="aigw-station-cond">{toneWord(s.tone)}</div>
              </div>
              <WeatherGlyph name={s.icon} size={FEATURED.has(s.id) ? 48 : 38} />
            </div>
            <div className="aigw-station-val">
              {/* the honesty rule of the board: a station with no reading says
                  «خوانده نشد» — a bare dash reads like a zero to a user */}
              {s.valueText
                ? s.valueText
                : <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-3)' }}>{L('خوانده نشد', 'unread')}</span>}
              {s.source ? <span style={{ fontSize: 9, color: 'var(--text-3)', marginInlineStart: 6, fontWeight: 700 }}>{s.source}</span> : null}
            </div>
            <div className="aigw-dial" aria-hidden="true">
              <i style={{ width: `${Math.round((s.severity || 0) * 100)}%` }} />
            </div>
            <div className="aigw-station-ev">{evidenceText(s.evidence, isPersian) || L('در این دور خوانده نشد', 'not read in this pass')}</div>
            {s.noteFa || s.noteEn ? (
              <div className="aigw-station-ev" style={{ color: 'var(--text-2)' }}>{isPersian ? s.noteFa : s.noteEn}</div>
            ) : null}
          </div>
        ))}
      </div>

      {/* ── the hourly strip (the weather-app gesture) ────────────────────── */}
      <div className="aigw-sec" style={{ marginTop: 16 }}>
        <WIcon name="clock" size={17} />
        {L('نوار ساعتی', 'Hourly strip')}
        <span className="aigw-sec-sub">{L('همان خوانش‌ها، فشرده', 'same reads, compact')}</span>
      </div>
      <div className="aigw-weather" role="list" aria-label={L('آب‌وهوای مالی', 'Financial weather')}>
        {hourly.map((w) => (
          <div key={w.id} className={`aigw-weather-card tone-${w.tone}`} role="listitem">
            <span className="aigw-weather-icon"><WeatherGlyph name={WEATHER_ICON[w.icon] || 'cloud'} size={30} /></span>
            <div className="aigw-weather-name">{isPersian ? WEATHER_META[w.id]?.fa : WEATHER_META[w.id]?.en}</div>
            <div className="aigw-weather-val">
              {typeof w.value === 'number' ? pct(w.value, isPersian) : (w.value === null || w.value === undefined ? '—' : String(w.value))}
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

      <div>
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
                        : m.valueUsd !== null && m.valueUsd !== undefined ? usdCompact(m.valueUsd).replace('+', '')
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
          <span style={{ display: 'block', fontSize: 11.5, fontWeight: 900, color: 'var(--text-1)' }}>{L('رادار جهانی FBT', 'FBT Global Radar')}</span>
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
          'هر جهت، سطح و دمای این صفحه از یک خوانش واقعی همین دور آمده و شواهدش کنارش نوشته شده است؛ ردیف «—» یعنی داده‌ای خوانده نشد، نه اینکه عددی پنهان باشد. اقلیم و وزن‌ها مدل‌اند و برچسب خورده‌اند.',
          'Every direction, level and temperature here comes from a real reading of this pass with its evidence beside it; a «—» row means nothing was read, not that a number is hidden. The climate index and weights are labelled model terms.'
        )}
      </div>
    </div>
  );
}

export default WorldStatePanel;

/* kept for callers that still import the old money helper */
export { moneyK };
