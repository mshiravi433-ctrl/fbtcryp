/**
 * WORLD CONSOLE — small shared parts.
 * ---------------------------------------------------------------------------
 * The quality badge is the one piece every panel needs: it says HOW a number
 * reached the screen (direct read · proxy · level only · last good read), so a
 * proxy can never be mistaken for the thing it stands in for.
 */
import { QUALITY_META } from './calibration.js';

export function QualityBadge({ quality, isPersian, className = '' }) {
  if (!quality) return null;
  const meta = QUALITY_META[quality];
  if (!meta) return null;
  const label = isPersian ? meta.fa : meta.en;
  return (
    <span className={`aigw-q q-${quality} ${className}`} title={label}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

const PERSIAN_LETTER = /[\u0600-\u06ff]/;
/* a signed number, a percentage, a multiplier or a «۱۳/۱۴» ratio — kept as ONE left-to-right island */
const NUM_TOKEN = /([+\u2212\-\u00d7]?[0-9\u06f0-\u06f9][0-9\u06f0-\u06f9.,\u066a\u066b\u066c%/]*)/g;

/**
 * Numbers, tickers and signed percentages keep their own direction inside RTL
 * text.
 *
 * A string that ALSO carries Persian words («−۸۰۰ هزار دلار», «اتریوم ۹۲ میلیون
 * دلار») must NOT be forced left-to-right as a whole: the bidi algorithm would
 * then lay the Persian words out after the number in reverse reading order.
 * Such a string flows right-to-left like the sentence around it, and only each
 * number inside it is isolated so a minus sign stays on the left of its digits.
 */
export function Ltr({ children, className = '', style, title }) {
  if (typeof children === 'string' && PERSIAN_LETTER.test(children)) {
    const parts = children.split(NUM_TOKEN);
    return (
      <bdi dir="rtl" className={`aigw-mixed ${className}`} style={style} title={title}>
        {parts.map((part, i) => (i % 2 ? <span key={i} dir="ltr" className="aigw-num">{part}</span> : part))}
      </bdi>
    );
  }
  return <bdi className={`aigw-ltr ${className}`} style={style} title={title}>{children}</bdi>;
}

/** «منبع: Ostium» — a calm one-line provenance footer */
export function SourceLine({ label, source, isPersian }) {
  if (!source) return null;
  return (
    <span className="aigw-srcline">
      {label || (isPersian ? 'منبع' : 'source')}: <b>{source}</b>
    </span>
  );
}
