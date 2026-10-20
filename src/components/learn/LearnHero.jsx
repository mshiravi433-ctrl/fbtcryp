/**
 * LearnHero — the glass header every Learn surface opens with.
 * ---------------------------------------------------------------------------
 * The hub renders it with the emblem and the three-reading meter strip; a
 * standalone route (/help, /docs, /aparat) renders the same card without
 * them, because a page reached from outside the hub still needs to say what
 * it is.
 *
 * ─── COMPACT BY CONSTRUCTION ───────────────────────────────────────────────
 * The Business hero once grew to ~460px on a 430px-wide phone with its top
 * third empty — «قسمت بالایی بدون هیچ چیز دراز شده». The three rules that keep
 * this one short: padding is 16/15px (not 22), every vertical step is on the
 * 4pt scale, and the intro is clamped to three lines. The emblem is dropped
 * below 400px rather than allowed to stretch the grid.
 *
 * ─── WHY THE STATS ARE ONE STRIP ───────────────────────────────────────────
 * Three loose chips under a title compete with the three tab badges directly
 * beneath them — six small rounded numbers in two rows. One instrument with
 * three readings is one thing to look at.
 */
import { IconChevronLeft } from '../Icons';

export function LearnTop({ title, sub, onBack, backLabel }) {
  return (
    <div className="lh-top">
      <button className="lh-back" type="button" onClick={onBack} aria-label={backLabel}>
        <IconChevronLeft width={18} height={18} />
      </button>
      <div className="lh-top-text">
        <h1 className="lh-top-title">{title}</h1>
        {sub ? <p className="lh-top-sub">{sub}</p> : null}
      </div>
    </div>
  );
}

export default function LearnHero({ kicker, title, sub, stats = [], art = null, compact = false, onBack, backLabel }) {
  return (
    <section className="lh-hero" data-compact={compact ? 'true' : 'false'}>
      <div className="lh-hero-grid">
        <div className="lh-hero-copy">
          {/*
           * The back button shares the kicker's row instead of sitting above
           * the card as its own header. /learn used to paint a title row AND a
           * hero — two headers, two chances to say the same thing — and the
           * page's <h1> was the smaller of the two.
           */}
          <div className="lh-hero-bar">
            {onBack ? (
              <button className="lh-back" type="button" onClick={onBack} aria-label={backLabel}>
                <IconChevronLeft width={18} height={18} />
              </button>
            ) : null}
            {kicker ? <span className="lh-kicker">{kicker}</span> : null}
          </div>
          <h1 className="lh-hero-title">{title}</h1>
          {sub ? <p className="lh-hero-sub">{sub}</p> : null}
          {stats.length > 0 && (
            <div className="lh-stats" role="list">
              {stats.map((s) => (
                <span className="lh-stat" role="listitem" key={s.label} style={{ '--a': s.a, '--b': s.b }}>
                  <span className="lh-stat-val">{s.value}</span>
                  <span className="lh-stat-lbl">{s.label}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        {art ? <div className="lh-hero-art">{art}</div> : null}
      </div>
    </section>
  );
}
