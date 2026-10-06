/**
 * THE BRIEFING — «گزارش وضعیت» as a board of tappable tiles.
 * ---------------------------------------------------------------------------
 * REPORTED (2026-10): «گزارش وضعیت مدرن‌تر شود؛ آیکون‌های مدرن، باکس‌ها
 * اطلاعات درست داشته باشند، با لمس هر باکس به صفحهٔ مربوطه برود، و بی‌نظیر
 * باشد».
 *
 *   · every tile is a VIEW of one calibrated station (worldModel.buildBriefingTiles),
 *     so the number on the tile and the number on the station board can never
 *     disagree; it carries its weather tone, a one-line calibrated reading
 *     («۱٫۸ برابر نوسان معمول · قوی») and a quality badge (direct / proxy);
 *   · every tile is a button that goes somewhere real: an in-console tab (the
 *     macro table, the causal chain, the globe, the future tree) or a page of
 *     the app (smart money, news, the market list, stocks);
 *   · the server's own briefing messages sit below the board as tappable rows.
 * A tile whose input was not read says «خوانده نشد» and is still a link — to the
 * place where the reason is explained.
 */
import { WIcon, WeatherGlyph } from './icons.jsx';
import { QualityBadge, Ltr } from './parts.jsx';
import { TONE_WORD } from './worldModel.js';

const GLYPH_OF = { sun: 'sun', partly: 'partly', cloud: 'cloud', rain: 'rain', storm: 'storm', windy: 'wind', na: 'na' };

function Tile({ tile, L, isPersian, onGo }) {
  const value = isPersian ? tile.valueFa : tile.valueEn;
  const unit = isPersian ? tile.unitFa : tile.unitEn;
  const title = isPersian ? tile.titleFa : tile.titleEn;
  const sub = isPersian ? tile.subFa : tile.subEn;
  const navLabel = isPersian ? tile.nav.fa : tile.nav.en;
  const word = tile.wordFa ? (isPersian ? tile.wordFa : tile.wordEn) : null;
  const pctUnit = typeof unit === 'string' && /[\u066a%]/.test(unit);
  return (
    <button
      type="button"
      data-tile={tile.id}
      className={`gw-tile t-${tile.tone} st-${tile.status} ${tile.wide ? 'wide' : ''}`}
      onClick={() => onGo(tile.nav)}
      aria-label={`${title}${value ? ` — ${value}` : ''} — ${L('برو به', 'open')} ${navLabel}`}
    >
      <span className="gw-tile-top">
        <span className="gw-tile-ico">
          {tile.wide
            ? <WeatherGlyph name={GLYPH_OF[tile.tone] || 'na'} size={44} />
            : <WIcon name={tile.icon} size={19} />}
        </span>
        <span className="gw-tile-title">{title}</span>
        <i className="gw-tile-go" aria-hidden="true" />
      </span>

      <span className="gw-tile-value">
        {value
          ? <><Ltr className="gw-v">{value}</Ltr>{unit ? (pctUnit ? <Ltr className="gw-u">{unit}</Ltr> : <small>{unit}</small>) : null}</>
          : <span className="gw-tile-unread">{L('خوانده نشد', 'unread')}</span>}
        {word ? <em className="gw-tile-word">{word}</em> : null}
      </span>

      {sub ? <span className="gw-tile-sub">{sub}</span> : null}

      <span className="gw-tile-foot">
        <QualityBadge quality={tile.quality} isPersian={isPersian} />
        <span className="gw-tile-nav">{navLabel}</span>
      </span>

      {tile.severity !== null && tile.severity !== undefined ? (
        <span className="gw-tile-dial" aria-hidden="true"><i style={{ width: `${Math.round(tile.severity * 100)}%` }} /></span>
      ) : null}
    </button>
  );
}

export function BriefingPanel({ board, messages, briefingAt, unreadInputs, L, isPersian, onGoTab, navigate, ageLabel }) {
  const go = (nav) => {
    if (!nav) return;
    if (nav.kind === 'tab') {
      onGoTab(nav.tab);
      if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* jsdom */ }
      }
    } else if (nav.to) navigate(nav.to);
  };
  const goMessage = (m) => {
    const to = m.to || '';
    if (!to || /^\/(global|ai-global)/.test(to)) {
      const tab = (to.match(/[?&]tab=([a-z]+)/) || [])[1];
      onGoTab(['world', 'globe', 'radar', 'causal', 'flows', 'future', 'dna', 'domains'].includes(tab) ? tab : (m.kind === 'macro' || m.kind === 'cross_asset' ? 'flows' : 'world'));
      return;
    }
    navigate(to);
  };

  const tiles = board?.tiles || [];
  const hasTiles = tiles.some((t) => t.status !== 'unread');

  return (
    <div className="aig-section gw-briefing">
      <div className="aig-section-title">
        <WIcon name="spark" size={18} style={{ color: 'var(--rgb-2)' }} />
        {L('گزارش وضعیت', 'Status report')}
        {ageLabel ? <span className="aig-item-kind">{ageLabel}</span> : null}
      </div>
      <p className="gw-briefing-lead">
        {L(
          'یک نگاه به جهان مالی همین دور. هر باکس را لمس کن تا به صفحهٔ مربوطه‌اش بروی؛ عددها با «روز معمول» همان بازار سنجیده شده‌اند.',
          'One look at this pass\u2019s financial world. Tap any box to open its page; every figure is scored against that market\u2019s normal day.'
        )}
      </p>

      {hasTiles ? (
        <div className="gw-tiles">
          {tiles.map((tile) => <Tile key={tile.id} tile={tile} L={L} isPersian={isPersian} onGo={go} />)}
        </div>
      ) : (
        <div className="aig-empty">
          {L('در این دور هنوز خوانشی نرسیده است — هیچ عددی حدس زده نمی‌شود.', 'No reading has arrived this pass — nothing is guessed.')}
        </div>
      )}

      <div className="gw-msgs">
        <div className="gw-msgs-h">
          <WIcon name="news" size={16} />
          {L('پیام‌های این دور', 'Messages of this pass')}
          {briefingAt ? <small>{ageLabel}</small> : null}
        </div>
        {messages.length ? messages.map((m) => (
          <button key={m.id} type="button" className={`gw-msg p-${m.priority}`} onClick={() => goMessage(m)}>
            <span className="gw-msg-dot" aria-hidden="true" />
            <span className="gw-msg-body">
              <span className="gw-msg-meta">
                <b className={`aig-prio ${m.priority}`}>{m.priorityLabel}</b>
                <span>{m.kindLabel}</span>
              </span>
              <span className="gw-msg-title"><bdi dir="auto">{m.title}</bdi></span>
              {m.detail ? <span className="gw-msg-detail"><bdi dir="auto">{m.detail}</bdi></span> : null}
              <span className="gw-msg-src">
                {m.sourceLabel}{m.confidencePct !== null && m.confidencePct !== undefined ? ` · ${isPersian ? m.confidencePctFa : m.confidencePct}%` : ''}
              </span>
            </span>
            <i className="gw-tile-go" aria-hidden="true" />
          </button>
        )) : (
          <div className="aig-empty">
            {L(
              'هنوز پیامی برای گفتن نیست — مغز مالی فقط از چیزی که واقعاً خوانده حرف می‌زند.',
              'Nothing to report yet — the financial brain only speaks from what it actually read.'
            )}
            {unreadInputs ? <div className="aig-note">{L('ورودی‌های خوانده‌نشده:', 'unread inputs:')} {unreadInputs}</div> : null}
          </div>
        )}
      </div>

      <div className="aig-note">
        {L(
          'گزارش یک توصیه به خواندن است؛ هیچ موردی مجوز اجرا ندارد. هر عدد از منبع خودش آمده و «پروکسی» یعنی جایگزین برچسب‌دار.',
          'A briefing is a recommendation to read — no item carries execution permission. Every number cites its source; «proxy» means a labelled stand-in.'
        )}
      </div>
    </div>
  );
}

export default BriefingPanel;

export { TONE_WORD };
