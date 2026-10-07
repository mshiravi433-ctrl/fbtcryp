/**
 * «هوش جهانی» — the 2026-10 visual layer.
 * ---------------------------------------------------------------------------
 * Loaded AFTER WORLD_STYLES, so everything here refines (never replaces) the
 * console's material:
 *
 *   · the hero     — an animated orbital instrument + live KPIs;
 *   · the report   — a bento board of tappable tiles;
 *   · the stations — calibrated cards, quality badges, the benchmark legend;
 *   · the macro table, the country card, the challenger and the domain rows;
 *   · the WIDE-SCREEN layout: on a desktop or a stretched window the console
 *     opens into columns instead of one narrow strip.
 *
 * MOTION: transform and opacity only, every loop slow, all of it off under
 * prefers-reduced-motion. Light and dark themes are both first-class.
 * No backslash escapes in here: this is a JS template literal.
 */
export const GLOBAL_PAGE_STYLES = `
  /* ══ root ═════════════════════════════════════════════════════════════ */
  .gw-root { --gw-radius: 22px; max-width: 1320px; margin-inline: auto; }
  .gw-root .aig-section { border-radius: 24px; }
  .gw-root .aigw-panel { --gap: 12px; }

  /* Persian words around numbers: the sentence flows right-to-left, each number is its own island */
  .aigw-mixed { unicode-bidi: isolate; direction: rtl; font-variant-numeric: tabular-nums; }
  .aigw-num { unicode-bidi: isolate; direction: ltr; font-variant-numeric: tabular-nums; }

  /* ══ the hero ═════════════════════════════════════════════════════════ */
  .gw-hero {
    position: relative; isolation: isolate; overflow: hidden;
    display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 12px;
    margin-bottom: 14px; padding: 18px 16px; border-radius: 28px;
    border: 1px solid color-mix(in srgb, var(--rgb-1) 30%, var(--line));
    background:
      radial-gradient(120% 140% at 100% 0%, color-mix(in srgb, var(--rgb-2) 24%, transparent), transparent 58%),
      radial-gradient(120% 140% at 0% 100%, color-mix(in srgb, var(--rgb-1) 20%, transparent), transparent 60%),
      linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.012));
    box-shadow: 0 30px 70px -48px rgba(0,0,0,0.95), inset 0 1px 0 rgba(255,255,255,0.06);
  }
  .gw-hero-glow { position: absolute; z-index: -1; width: 230px; height: 230px; border-radius: 50%; filter: blur(48px); opacity: .3; pointer-events: none; }
  .gw-hero-glow.g1 { inset-inline-end: -70px; top: -100px; background: var(--rgb-2); animation: gw-float 15s ease-in-out infinite; }
  .gw-hero-glow.g2 { inset-inline-start: -90px; bottom: -120px; background: var(--rgb-1); animation: gw-float 19s ease-in-out infinite reverse; }
  .gw-hero-copy { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; }
  .gw-eyebrow {
    display: inline-flex; align-items: center; gap: 7px; padding: 4px 11px; border-radius: 999px;
    font-size: 10.5px; font-weight: 850; color: var(--text-2);
    background: color-mix(in srgb, var(--bg-panel-solid) 60%, transparent);
    border: 1px solid color-mix(in srgb, var(--line) 75%, transparent);
  }
  .gw-eyebrow small { font-size: 9.5px; font-weight: 700; color: var(--text-3); }
  .gw-live { position: relative; width: 8px; height: 8px; border-radius: 50%; background: var(--up); }
  .gw-live::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: var(--up); animation: gw-ping 2.2s ease-out infinite; }
  .gw-hero.is-working .gw-live { background: var(--rgb-5); }
  .gw-hero.is-working .gw-live::after { background: var(--rgb-5); animation-duration: 1.1s; }
  .gw-hero-title { margin: 9px 0 0; font-size: clamp(27px, 5.4vw, 42px); font-weight: 950; line-height: 1.22; letter-spacing: -0.02em; color: var(--text-1); }
  .gw-hero-title span {
    display: inline-block; padding-bottom: .05em;
    background: linear-gradient(100deg, var(--text-1) 0%, var(--rgb-1) 48%, var(--rgb-2) 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent;
  }
  .gw-hero-title::after {
    content: ''; display: block; position: relative; width: 74px; height: 3px; margin-top: 6px; border-radius: 99px; overflow: hidden;
    background: linear-gradient(90deg, var(--rgb-1), var(--rgb-2));
  }
  .gw-hero-sub { margin: 9px 0 0; max-width: 62ch; font-size: 11.5px; line-height: 2; color: var(--text-3); font-weight: 650; }
  .gw-meter { width: 100%; max-width: 420px; margin-top: 12px; }
  .gw-kpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; width: 100%; margin-top: 14px; }
  .gw-kpi {
    position: relative; overflow: hidden; padding: 10px 11px; border-radius: 15px; min-width: 0;
    background: color-mix(in srgb, var(--bg-panel-solid) 58%, transparent);
    border: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
  }
  .gw-kpi::before { content: ''; position: absolute; inset-block: 8px; inset-inline-start: 0; width: 3px; border-radius: 99px; background: var(--kc, var(--rgb-1)); }
  .gw-kpi.t-sun { --kc: var(--up); } .gw-kpi.t-partly { --kc: #38bdf8; } .gw-kpi.t-cloud { --kc: #94a3b8; }
  .gw-kpi.t-rain { --kc: #f59e0b; } .gw-kpi.t-storm { --kc: var(--down); } .gw-kpi.t-windy { --kc: #a78bfa; } .gw-kpi.t-na { --kc: var(--text-3); }
  .gw-kpi b { display: block; font-size: 18px; font-weight: 950; line-height: 1.2; color: var(--text-1); }
  .gw-kpi span { display: block; margin-top: 3px; font-size: 9.5px; font-weight: 750; color: var(--text-3); line-height: 1.5; }

  /* ── the globe: TOP-LEFT of the banner, and it IS the refresh control ──
     2026-10-07: it used to sit vertically centred in the first grid column,
     which in RTL is the RIGHT side, and the «refresh live data» bar lived
     under the tab rail. Now the instrument is the button.

     Grid columns run along the inline axis, so "physically left" is the LAST
     column when dir=rtl and the FIRST when dir=ltr — hence the two mirrors. */
  .gw-hero-art { width: 96px; align-self: start; }
  .gw-root[dir='rtl'] .gw-hero { grid-template-columns: minmax(0, 1fr) auto; }
  .gw-root[dir='rtl'] .gw-hero-art { grid-column: 2; grid-row: 1; justify-self: end; }
  .gw-root[dir='rtl'] .gw-hero-copy { grid-column: 1; grid-row: 1; }
  .gw-root[dir='ltr'] .gw-hero { grid-template-columns: auto minmax(0, 1fr); }
  .gw-root[dir='ltr'] .gw-hero-art { grid-column: 1; grid-row: 1; justify-self: start; }
  .gw-root[dir='ltr'] .gw-hero-copy { grid-column: 2; grid-row: 1; }

  /* a <button> that must look exactly like the instrument it replaced */
  .gw-hero-refresh {
    display: block; min-width: 0; padding: 0; border: 0; border-radius: 50%;
    background: none; color: inherit; font: inherit; text-align: center;
    cursor: pointer; -webkit-tap-highlight-color: transparent;
    transition: transform .22s cubic-bezier(.4,0,.2,1), opacity .22s ease;
  }
  .gw-hero-refresh:hover:not(:disabled) { transform: translateY(-2px) scale(1.03); }
  .gw-hero-refresh:active:not(:disabled) { transform: scale(.97); }
  .gw-hero-refresh:focus-visible { outline: 2px solid var(--rgb-2); outline-offset: 4px; }
  .gw-hero-refresh:disabled { cursor: progress; opacity: .8; }
  .gw-hero-refresh-hint {
    display: block; margin-top: 6px; font-size: 8.5px; font-weight: 850; line-height: 1.6;
    color: var(--text-3); opacity: .7; transition: opacity .2s ease, color .2s ease;
  }
  .gw-hero-refresh:hover:not(:disabled) .gw-hero-refresh-hint { opacity: 1; color: var(--rgb-1); }
  /* a read in flight: the rings and the sweep speed up, so the globe itself
     says «working» where the retired bar used to spin an icon */
  .gw-hero-refresh.is-refreshing .gw-spin.s1 { animation-duration: 2.4s; }
  .gw-hero-refresh.is-refreshing .gw-spin.s2 { animation-duration: 3.2s; }
  .gw-hero-refresh.is-refreshing .gw-spin.s3 { animation-duration: 1.7s; }
  .gw-hero-refresh.is-refreshing .gw-sweep { animation-duration: 1.5s; }
  .gw-hero-refresh.is-refreshing .gw-pulse { animation-duration: 1.3s; }

  .gw-orbital { display: block; width: 100%; height: auto; overflow: visible; filter: drop-shadow(0 14px 28px color-mix(in srgb, var(--rgb-2) 38%, transparent)); }
  .gw-orbital .gw-spin, .gw-orbital .gw-sweep, .gw-orbital .gw-pulse, .gw-orbital .gw-land { transform-box: view-box; }
  .gw-orbital .gw-spin.s1 { animation: gw-rot 17s linear infinite; }
  .gw-orbital .gw-spin.s2 { animation: gw-rot 29s linear infinite reverse; }
  .gw-orbital .gw-spin.s3 { animation: gw-rot 11s linear infinite; }
  .gw-orbital .gw-sweep { animation: gw-rot 7.5s linear infinite; }
  .gw-orbital .gw-pulse { animation: gw-pulse 5s ease-in-out infinite; }
  .gw-orbital .gw-land { animation: gw-rot 90s linear infinite; opacity: .9; }
  .gw-orbital .gw-tw { animation: gw-tw 3.4s ease-in-out infinite; }
  .gw-orbital .gw-tw.t2 { animation-delay: 1.1s; } .gw-orbital .gw-tw.t3 { animation-delay: 2.1s; }

  @keyframes gw-rot { to { transform: rotate(360deg); } }
  @keyframes gw-float { 0%, 100% { transform: translate3d(0, 0, 0); } 50% { transform: translate3d(14px, 18px, 0); } }
  @keyframes gw-pulse { 0%, 100% { transform: scale(.92); opacity: .12; } 50% { transform: scale(1.1); opacity: .28; } }
  @keyframes gw-tw { 0%, 100% { opacity: .12; } 50% { opacity: 1; } }
  @keyframes gw-ping { 0% { transform: scale(1); opacity: .55; } 80%, 100% { transform: scale(2.6); opacity: 0; } }
  @keyframes gw-glint { 0% { transform: translateX(-100%); } 55%, 100% { transform: translateX(200%); } }
  @keyframes gw-glint-rtl { 0% { transform: translateX(100%); } 55%, 100% { transform: translateX(-200%); } }
  .gw-root[dir='rtl'] .gw-hero-title::before { animation-name: gw-glint-rtl; }
  .gw-hero-title::before {
    content: ''; position: absolute; inset-inline-start: 0; bottom: 0; width: 24px; height: 3px; z-index: 1;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.95), transparent);
    animation: gw-glint 4.2s ease-in-out infinite; pointer-events: none;
  }
  .gw-hero-title { position: relative; }
  .gw-hero-title::before { bottom: 0; }

  /* ══ the tab rail ═════════════════════════════════════════════════════ */
  .gw-root .aig-tabs { scroll-snap-type: x proximity; }
  .gw-root .aig-tab { scroll-snap-align: start; }

  /* ══ the status report: a bento board ═════════════════════════════════ */
  .gw-briefing-lead { margin: 2px 0 14px; font-size: 11.5px; line-height: 2; color: var(--text-3); font-weight: 650; }
  .gw-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .gw-tile {
    --tone: var(--rgb-1);
    position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: stretch; gap: 7px;
    min-width: 0; padding: 13px 13px 15px; text-align: start; cursor: pointer; font: inherit; color: var(--text-1);
    border-radius: 20px; border: 1px solid color-mix(in srgb, var(--tone) 30%, var(--line));
    background:
      radial-gradient(130% 120% at 100% 0%, color-mix(in srgb, var(--tone) 15%, transparent), transparent 62%),
      linear-gradient(165deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01)), var(--bg-raised);
    box-shadow: 0 18px 38px -34px color-mix(in srgb, var(--tone) 80%, transparent);
    transition: transform .22s cubic-bezier(.4,0,.2,1), border-color .22s, box-shadow .22s;
    -webkit-tap-highlight-color: transparent;
  }
  .gw-tile:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--tone) 58%, var(--line)); box-shadow: 0 24px 44px -30px color-mix(in srgb, var(--tone) 85%, transparent); }
  .gw-tile:active { transform: scale(.985); }
  .gw-tile:focus-visible { outline: 2px solid var(--tone); outline-offset: 2px; }
  .gw-tile.t-sun { --tone: var(--up); } .gw-tile.t-partly { --tone: #38bdf8; } .gw-tile.t-cloud { --tone: #94a3b8; }
  .gw-tile.t-rain { --tone: #f59e0b; } .gw-tile.t-storm { --tone: var(--down); } .gw-tile.t-windy { --tone: #a78bfa; } .gw-tile.t-na { --tone: #64748b; }
  .gw-tile.st-unread { opacity: .86; border-style: dashed; }
  .gw-tile.wide { grid-column: 1 / -1; padding: 16px 16px 18px; }
  .gw-tile-top { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .gw-tile-ico {
    display: grid; place-items: center; flex: 0 0 auto; width: 36px; height: 36px; border-radius: 12px; color: var(--tone);
    background: linear-gradient(140deg, color-mix(in srgb, var(--tone) 26%, transparent), color-mix(in srgb, var(--tone) 8%, transparent));
    border: 1px solid color-mix(in srgb, var(--tone) 30%, transparent);
  }
  .gw-tile.wide .gw-tile-ico { width: 56px; height: 56px; border-radius: 18px; }
  .gw-tile-title { flex: 1; min-width: 0; font-size: 11.5px; font-weight: 900; line-height: 1.5; color: var(--text-1); }
  .gw-tile-go { position: relative; flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; background: color-mix(in srgb, var(--tone, var(--rgb-1)) 14%, transparent); transition: transform .22s; }
  .gw-tile-go::before { content: ''; position: absolute; inset: 0; margin: auto; width: 6px; height: 6px; border-inline-end: 2px solid var(--tone, var(--rgb-1)); border-block-start: 2px solid var(--tone, var(--rgb-1)); transform: rotate(45deg) translate(-1px, 1px); }
  .gw-root[dir='rtl'] .gw-tile-go::before { transform: rotate(-135deg) translate(-1px, 1px); }
  .gw-tile:hover .gw-tile-go { transform: translateX(2px); }
  .gw-root[dir='rtl'] .gw-tile:hover .gw-tile-go { transform: translateX(-2px); }
  .gw-tile-value { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; min-height: 30px; }
  .gw-tile-value .gw-v { font-size: 22px; font-weight: 950; line-height: 1.2; color: var(--text-1); }
  .gw-tile.wide .gw-tile-value .gw-v { font-size: 34px; }
  .gw-tile-value small, .gw-tile-value .gw-u { font-size: 10.5px; font-weight: 800; color: var(--text-3); }
  .gw-tile-value .gw-u { color: var(--tone); }
  .gw-tile-word { font-style: normal; font-size: 12px; font-weight: 900; color: var(--tone); margin-inline-start: auto; }
  .gw-tile-unread { font-size: 12px; font-weight: 850; color: var(--text-3); }
  .gw-tile-sub { font-size: 10px; line-height: 1.8; color: var(--text-2); font-weight: 650; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .gw-tile-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 2px; min-height: 20px; }
  .gw-tile-nav { font-size: 9.5px; font-weight: 800; color: var(--tone); opacity: .9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gw-tile-dial { position: absolute; inset-inline: 0; bottom: 0; height: 3px; direction: ltr; background: color-mix(in srgb, var(--text-1) 8%, transparent); }
  .gw-tile-dial i { position: absolute; inset-block: 0; inset-inline-start: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--tone) 40%, transparent), var(--tone)); transition: width .8s cubic-bezier(.3,.7,.2,1); }

  .gw-msgs { margin-top: 18px; }
  .gw-msgs-h { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 12px; font-weight: 900; color: var(--text-1); }
  .gw-msgs-h small { margin-inline-start: auto; font-size: 10px; font-weight: 700; color: var(--text-3); }
  .gw-msg {
    display: flex; align-items: flex-start; gap: 10px; width: 100%; margin-bottom: 8px; padding: 12px 13px; text-align: start; cursor: pointer; font: inherit; color: inherit;
    border-radius: 17px; border: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
    background: linear-gradient(165deg, rgba(255,255,255,0.045), rgba(255,255,255,0.008)), var(--bg-raised);
    transition: transform .2s, border-color .2s;
  }
  .gw-msg:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--rgb-1) 40%, var(--line)); }
  .gw-msg:focus-visible { outline: 2px solid var(--rgb-1); outline-offset: 2px; }
  .gw-msg-dot { flex: 0 0 auto; width: 9px; height: 9px; margin-top: 6px; border-radius: 50%; background: var(--rgb-1); box-shadow: 0 0 10px -1px var(--rgb-1); }
  .gw-msg.p-critical .gw-msg-dot { background: var(--down); box-shadow: 0 0 10px -1px var(--down); }
  .gw-msg.p-high .gw-msg-dot { background: #f59e0b; box-shadow: 0 0 10px -1px #f59e0b; }
  .gw-msg.p-info .gw-msg-dot { background: #38bdf8; box-shadow: 0 0 10px -1px #38bdf8; }
  .gw-msg-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
  .gw-msg-meta { display: flex; align-items: center; gap: 8px; font-size: 9.5px; color: var(--text-3); font-weight: 750; }
  .gw-msg-title { font-size: 12.5px; font-weight: 850; line-height: 1.8; color: var(--text-1); overflow-wrap: anywhere; }
  .gw-msg-detail { font-size: 10.5px; line-height: 1.9; color: var(--text-2); overflow-wrap: anywhere; }
  .gw-msg-src { font-size: 9.5px; color: var(--text-3); }
  .gw-msg .gw-tile-go { margin-top: 3px; --tone: var(--rgb-1); }

  /* ══ quality badges + the station board ═══════════════════════════════ */
  .aigw-q { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: 9px; font-weight: 850; white-space: nowrap; vertical-align: middle;
    color: var(--text-2); background: color-mix(in srgb, var(--text-1) 6%, transparent); border: 1px solid color-mix(in srgb, var(--line) 80%, transparent); margin-inline-start: 6px; }
  .aigw-q i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); }
  .aigw-q.q-measured { color: var(--up); background: color-mix(in srgb, var(--up) 10%, transparent); border-color: color-mix(in srgb, var(--up) 28%, transparent); }
  .aigw-q.q-measured i { background: var(--up); }
  .aigw-q.q-proxy { color: var(--rgb-5); background: color-mix(in srgb, var(--rgb-5) 11%, transparent); border-color: color-mix(in srgb, var(--rgb-5) 30%, transparent); }
  .aigw-q.q-proxy i { background: var(--rgb-5); }
  .aigw-q.q-level i, .aigw-q.q-stale i { background: #94a3b8; }
  .gw-tile-foot .aigw-q, .aigw-station-meta .aigw-q { margin-inline-start: 0; }

  .aigw-climate-cap { margin-top: 9px; font-size: 9.5px; line-height: 1.9; color: var(--text-3); }
  .aigw-stations-sum { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 10px; }
  .aigw-sum-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 10px; font-weight: 800; color: var(--text-2);
    background: color-mix(in srgb, var(--text-1) 5%, transparent); border: 1px solid color-mix(in srgb, var(--line) 78%, transparent); }
  .aigw-sum-chip i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); }
  .aigw-sum-chip b { color: var(--text-1); font-weight: 950; direction: ltr; }
  .aigw-sum-chip.s-measured i { background: var(--up); } .aigw-sum-chip.s-proxy i { background: var(--rgb-5); } .aigw-sum-chip.s-level i { background: #94a3b8; } .aigw-sum-chip.s-unread i { background: var(--down); opacity: .7; }

  .aigw-bench { margin: 0 0 12px; border-radius: 16px; border: 1px solid color-mix(in srgb, var(--acc1) 24%, var(--line)); background: color-mix(in srgb, var(--acc1) 6%, var(--bg-raised)); }
  .aigw-bench > summary { display: flex; align-items: center; gap: 8px; padding: 11px 13px; cursor: pointer; list-style: none; font-size: 11px; font-weight: 900; color: var(--text-1); }
  .aigw-bench > summary::-webkit-details-marker { display: none; }
  .aigw-bench > summary > svg { color: var(--acc1); flex: 0 0 auto; }
  .aigw-bench > summary > span { flex: 1; min-width: 0; }
  .aigw-bench-caret { position: relative; width: 14px; height: 14px; flex: 0 0 auto; transition: transform .22s; }
  .aigw-bench-caret::before { content: ''; position: absolute; inset: 0; margin: auto; width: 6px; height: 6px; border-inline-end: 2px solid var(--text-3); border-block-end: 2px solid var(--text-3); transform: rotate(45deg) translate(-2px, -2px); }
  .aigw-bench[open] .aigw-bench-caret, .aigw-adv-more[open] .aigw-bench-caret { transform: rotate(180deg); }
  .aigw-bench-body { padding: 0 13px 13px; }
  .aigw-bench-body p { margin: 0 0 10px; font-size: 10.5px; line-height: 2; color: var(--text-2); }
  .aigw-bench-bands { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-bottom: 10px; }
  .aigw-band { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 7px 4px; border-radius: 12px; font-size: 10px; border: 1px solid color-mix(in srgb, var(--line) 75%, transparent); background: color-mix(in srgb, var(--text-1) 4%, transparent); }
  .aigw-band b { font-weight: 900; color: var(--text-1); } .aigw-band small { font-size: 9px; color: var(--text-3); direction: ltr; }
  .aigw-band.b-calm { border-color: color-mix(in srgb, #38bdf8 40%, var(--line)); } .aigw-band.b-normal { border-color: color-mix(in srgb, var(--up) 40%, var(--line)); }
  .aigw-band.b-strong { border-color: color-mix(in srgb, #f59e0b 45%, var(--line)); } .aigw-band.b-extreme { border-color: color-mix(in srgb, var(--down) 50%, var(--line)); }
  .aigw-bench-table { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 14px; }
  .aigw-bench-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px dashed color-mix(in srgb, var(--line) 70%, transparent); font-size: 10.5px; color: var(--text-2); }
  .aigw-bench-row .aigw-ltr { font-weight: 900; color: var(--text-1); }
  .aigw-bench-body .aigw-bench-note { margin: 10px 0 0; font-size: 10px; color: var(--text-3); }

  .aigw-stations { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .aigw-station { display: flex; flex-direction: column; gap: 0; }
  .aigw-station.feature { grid-column: 1 / -1; }
  .aigw-station-cond { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .aigw-band-dot { font-size: 9px; font-weight: 850; padding: 1px 7px; border-radius: 999px; color: var(--text-2); background: color-mix(in srgb, var(--text-1) 7%, transparent); }
  .aigw-band-dot.b-extreme { color: var(--down); background: color-mix(in srgb, var(--down) 12%, transparent); }
  .aigw-band-dot.b-strong { color: #f59e0b; background: color-mix(in srgb, #f59e0b 12%, transparent); }
  .aigw-station-val { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; direction: inherit; }
  .aigw-station-val .aigw-ltr { font-size: inherit; }
  .aigw-station-val small { font-size: 10px; font-weight: 800; color: var(--text-3); }
  .aigw-station-unread { font-size: 11px; font-weight: 800; color: var(--text-3); }
  .aigw-station-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .aigw-station-read { font-size: 10px; font-weight: 800; color: var(--text-2); line-height: 1.7; }
  .aigw-station-ev { display: flex; flex-wrap: wrap; gap: 5px; }
  .aigw-ev { display: inline-flex; align-items: baseline; gap: 5px; padding: 2px 8px; border-radius: 8px; font-size: 9.5px; color: var(--text-3); background: color-mix(in srgb, var(--text-1) 5%, transparent); }
  .aigw-ev .aigw-ltr { font-weight: 900; color: var(--text-1); }
  .aigw-station-basis { margin-top: 6px; font-size: 9.5px; line-height: 1.8; color: var(--text-3); }
  .aigw-station-src { margin-top: auto; padding-top: 7px; font-size: 9px; color: var(--text-3); }
  .aigw-station-src b { color: var(--text-2); font-weight: 800; }
  .aigw-station.q-proxy { border-style: dashed; }
  .aigw-station.q-none { opacity: .88; }
  .aigw-stations-compact .aigw-station { padding: 10px 11px; }

  /* ══ the macro table: dollar · gold · bonds ═══════════════════════════ */
  .aigw-anchors { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-bottom: 4px; }
  .aigw-anchor { display: flex; flex-direction: column; gap: 7px; min-width: 0; padding: 11px 12px; border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
    background: linear-gradient(165deg, rgba(255,255,255,0.045), rgba(255,255,255,0.008)), var(--bg-raised); }
  .aigw-anchor.q-proxy { border-style: dashed; border-color: color-mix(in srgb, var(--rgb-5) 38%, var(--line)); }
  .aigw-anchor.st-unread { opacity: .8; }
  .aigw-anchor-top { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
  .aigw-anchor-ico { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; color: var(--acc1); background: color-mix(in srgb, var(--acc1) 12%, transparent); }
  .aigw-anchor-name { flex: 1; min-width: 0; font-size: 11px; font-weight: 900; color: var(--text-1); }
  .aigw-anchor-level { font-size: 16px; font-weight: 950; color: var(--text-1); line-height: 1.4; }
  .aigw-anchor-dim { font-size: 10.5px; font-weight: 700; color: var(--text-3); }
  .aigw-anchor-unread { font-size: 10.5px; font-weight: 800; color: var(--text-3); }
  .aigw-anchor-move { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .aigw-anchor-src { font-size: 9px; color: var(--text-3); }
  .aigw-anchor-basis { font-size: 9.5px; line-height: 1.8; color: var(--text-3); }

  .aigw-flow-node-name { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; font-size: 12px; font-weight: 900; color: var(--text-1); }
  .aigw-flow-node-lvl { margin-top: 3px; font-size: 10px; color: var(--text-2); font-weight: 750; }
  .aigw-flow-node-basis { margin-top: 3px; font-size: 9.5px; color: var(--text-3); line-height: 1.7; }
  .aigw-chain-ev { margin-top: 3px; font-size: 9.5px; color: var(--text-2); line-height: 1.8; overflow-wrap: anywhere; }
  .aigw-chain-arrow { height: auto; min-height: 26px; padding: 2px 0; gap: 3px; }
  .aigw-chain-cap { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 6px; max-width: 94%; padding: 3px 10px; border-radius: 999px; text-align: center;
    font-size: 9.5px; line-height: 1.7; color: var(--text-2); background: color-mix(in srgb, var(--text-1) 5%, transparent); }
  .aigw-chain-cap b { font-weight: 900; padding: 0 6px; border-radius: 99px; }
  .aigw-chain-cap b.ok { color: var(--up); background: color-mix(in srgb, var(--up) 12%, transparent); }
  .aigw-chain-cap b.no { color: var(--down); background: color-mix(in srgb, var(--down) 12%, transparent); }

  /* ══ the country card ═════════════════════════════════════════════════ */
  .aigw-country-nm { font-weight: 900; }
  .aigw-country-tk { font-size: 9px; font-weight: 800; color: var(--text-3); padding: 1px 6px; border-radius: 6px; background: color-mix(in srgb, var(--text-1) 6%, transparent); }
  .aigw-country-sym { flex-wrap: wrap; }
  .aigw-country-row.k-news { align-items: flex-start; }
  .aigw-country-news { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 4px; }
  .aigw-country-news li { font-size: 10px; line-height: 1.8; color: var(--text-2); padding-inline-start: 10px; position: relative; overflow-wrap: anywhere; }
  .aigw-country-news li::before { content: ''; position: absolute; inset-inline-start: 0; top: .75em; width: 4px; height: 4px; border-radius: 50%; background: var(--acc1); }
  .aigw-country-news small { color: var(--text-3); }

  /* ══ the future tree: the spacing the DNA/future tab was missing ══════ */
  .aigw-tree-root { margin-top: 2px; margin-bottom: 14px; }
  .aigw-branch { margin-bottom: 10px; }
  .aigw-branch:last-of-type { margin-bottom: 14px; }

  /* ══ the DNA tab: one calm rhythm between its blocks ═════════════════ */
  .aigw-panel.acc-dna > .aigw-chips { margin-bottom: 12px; }
  .aigw-panel.acc-dna .aigw-hex { margin: 10px auto 16px; }
  .aigw-panel.acc-dna .aigw-dna-obs { margin-top: 14px; }
  .aigw-dna-src { opacity: .75; font-weight: 700; }

  /* ══ the challenger: calm, observed-only ══════════════════════════════ */
  .aigw-adv { margin-top: 16px; padding: 16px; border-radius: 22px; }
  .aigw-adv-head { display: flex; align-items: center; gap: 11px; margin-bottom: 12px; }
  .aigw-adv-badge { display: grid; place-items: center; flex: 0 0 auto; width: 38px; height: 38px; border-radius: 13px; color: var(--down);
    background: color-mix(in srgb, var(--down) 12%, transparent); border: 1px solid color-mix(in srgb, var(--down) 28%, transparent); }
  .aigw-adv-h { font-size: 12.5px; font-weight: 950; color: var(--text-1); line-height: 1.6; }
  .aigw-adv-sub { margin-top: 1px; font-size: 10px; color: var(--text-3); }
  .aigw-adv-opp { padding: 11px 12px; margin-bottom: 11px; border-radius: 15px; background: color-mix(in srgb, var(--bg-panel-solid) 55%, transparent); border: 1px solid color-mix(in srgb, var(--line) 72%, transparent); }
  .aigw-adv-opp-k { font-size: 9.5px; font-weight: 800; color: var(--text-3); }
  .aigw-adv-opp-main { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 4px; font-size: 13px; color: var(--text-1); }
  .aigw-adv-opp-main b { font-weight: 950; }
  .aigw-adv-subject { padding: 1px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 900; color: var(--acc1); background: color-mix(in srgb, var(--acc1) 12%, transparent); }
  .aigw-adv-opp-val { margin-inline-start: auto; font-size: 13px; font-weight: 950; color: var(--up); }
  .aigw-adv-opp-d { margin-top: 3px; font-size: 10px; color: var(--text-3); line-height: 1.8; }
  .aigw-adv-summary { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; font-size: 10.5px; font-weight: 800; color: var(--text-2); line-height: 1.8; }
  .aigw-adv-meter { display: inline-flex; gap: 3px; direction: ltr; flex: 0 0 auto; }
  .aigw-adv-meter i { width: 18px; height: 6px; border-radius: 99px; background: color-mix(in srgb, var(--text-1) 12%, transparent); }
  .aigw-adv-meter i.on.l1 { background: #38bdf8; } .aigw-adv-meter i.on.l2 { background: #f59e0b; } .aigw-adv-meter i.on.l3 { background: var(--down); }
  .aigw-adv-row { padding: 11px 0; }
  .aigw-adv-ico { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 10px; margin-top: 0; }
  .aigw-adv-ico.observed { background: color-mix(in srgb, var(--down) 12%, transparent); }
  .aigw-adv-title { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; font-size: 11.5px; }
  .aigw-adv-ev { margin-top: 3px; font-size: 10.5px; color: var(--text-2); font-weight: 700; }
  .aigw-adv-why { margin-top: 2px; font-size: 10px; line-height: 1.9; color: var(--text-3); }
  .aigw-pips { display: inline-flex; gap: 3px; margin-inline-start: auto; direction: ltr; }
  .aigw-pips i { width: 6px; height: 6px; border-radius: 50%; background: color-mix(in srgb, var(--text-1) 14%, transparent); }
  .aigw-pips i.on { background: var(--down); }
  .aigw-adv-calm { display: flex; align-items: center; gap: 8px; padding: 12px; margin: 4px 0; border-radius: 14px; font-size: 11px; font-weight: 800; color: var(--up);
    background: color-mix(in srgb, var(--up) 9%, transparent); border: 1px solid color-mix(in srgb, var(--up) 24%, transparent); }
  .aigw-adv-more { margin-top: 8px; }
  .aigw-adv-more > summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 2px; cursor: pointer; list-style: none; font-size: 10.5px; font-weight: 850; color: var(--text-3); }
  .aigw-adv-more > summary::-webkit-details-marker { display: none; }
  .aigw-adv-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0 6px; }
  .aigw-adv-chip { padding: 3px 10px; border-radius: 999px; font-size: 10px; font-weight: 800; color: var(--text-3); background: color-mix(in srgb, var(--text-1) 5%, transparent); border: 1px dashed color-mix(in srgb, var(--line) 85%, transparent); }
  .aigw-adv-chip.obs { color: var(--down); border-style: solid; background: color-mix(in srgb, var(--down) 9%, transparent); border-color: color-mix(in srgb, var(--down) 28%, transparent); }
  .aigw-adv-fine { font-size: 9.5px; line-height: 1.9; color: var(--text-3); }

  /* ══ the domains: ONE WIDE ROW PER DOMAIN ═════════════════════════════ */
  .aigw-domlist { display: flex; flex-direction: column; gap: 9px; }
  .aigw-domrow { border-radius: 18px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--line) 76%, transparent);
    background: linear-gradient(165deg, rgba(255,255,255,0.045), rgba(255,255,255,0.008)), var(--bg-raised);
    transition: border-color .22s, box-shadow .22s; }
  .aigw-domrow:hover { border-color: var(--acc-line, color-mix(in srgb, var(--acc1) 34%, transparent)); }
  .aigw-domrow.open { border-color: color-mix(in srgb, var(--acc1) 46%, var(--line)); box-shadow: 0 18px 40px -34px color-mix(in srgb, var(--acc1) 80%, transparent); }
  .aigw-domrow.tone-off { opacity: .92; }
  .aigw-domrow .aigw-dom {
    all: unset; box-sizing: border-box; width: 100%; cursor: pointer;
    display: grid; align-items: center; column-gap: 12px; row-gap: 8px; padding: 13px 14px;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: "ico main side" "line line line" "stats stats stats";
  }
  .aigw-domrow .aigw-dom:hover { transform: none; }
  .aigw-domrow .aigw-dom:focus-visible { outline: 2px solid var(--acc1); outline-offset: -2px; border-radius: 16px; }
  .aigw-domrow .aigw-dom-ico { grid-area: ico; width: 38px; height: 38px; border-radius: 13px; }
  .aigw-dom-main { grid-area: main; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .aigw-domrow .aigw-dom-name { font-size: 13px; font-weight: 950; color: var(--text-1); }
  .aigw-dom-role { font-size: 10px; color: var(--text-3); font-weight: 650; line-height: 1.6; }
  .aigw-dom-line { grid-area: line; font-size: 11px; line-height: 1.9; color: var(--text-2); font-weight: 700; overflow-wrap: anywhere; }
  .aigw-dom-stats { grid-area: stats; display: flex; flex-wrap: wrap; gap: 6px; }
  .aigw-dom-stats:empty { display: none; }
  .aigw-dom-stat { display: inline-flex; align-items: baseline; gap: 6px; padding: 3px 10px; border-radius: 10px; font-size: 10px; color: var(--text-3);
    background: color-mix(in srgb, var(--text-1) 5%, transparent); border: 1px solid color-mix(in srgb, var(--line) 68%, transparent); }
  .aigw-dom-stat small { font-size: 9.5px; font-weight: 700; }
  .aigw-dom-stat b { font-weight: 950; font-size: 11px; }
  .aigw-dom-side { grid-area: side; display: flex; align-items: center; gap: 8px; }
  .aigw-dom-caret { position: relative; width: 14px; height: 14px; transition: transform .22s; }
  .aigw-dom-caret::before { content: ''; position: absolute; inset: 0; margin: auto; width: 6px; height: 6px; border-inline-end: 2px solid var(--text-3); border-block-end: 2px solid var(--text-3); transform: rotate(45deg) translate(-2px, -2px); }
  .aigw-domrow.open .aigw-dom-caret { transform: rotate(180deg); }
  .aigw-dom-open { padding: 2px 14px 14px; border-top: 1px dashed color-mix(in srgb, var(--line) 78%, transparent); animation: gw-open .22s ease-out; }
  @keyframes gw-open { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
  .aigw-dom-open .aigw-dom-meta { margin-top: 10px; font-size: 10px; color: var(--text-3); line-height: 1.9; }
  .aigw-dom-open .aigw-dom-item { padding: 8px 0; font-size: 10.5px; flex-wrap: wrap; }
  .aigw-dom-title { flex: 1 1 60%; color: var(--text-1); }
  .aigw-dom-open .aigw-dom-item .ell { white-space: normal; }

  .aigw-srcline { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 8px; font-size: 9.5px; line-height: 1.8; color: var(--text-3); }
  .aigw-srcline b { font-weight: 850; color: var(--text-2); }

  /* ══ gauges as columns, the strip as a wrap ═══════════════════════════ */
  .aigw-gauges { display: block; }
  .aigw-chips { flex-wrap: nowrap; }

  /* ══ wide screens: the console opens into columns ═════════════════════ */
  .gw-cols { display: block; }
  @media (min-width: 560px) {
    .gw-hero { padding: 22px 22px; }
    .gw-hero-art { width: 128px; }
    .gw-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .gw-tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .gw-tile.wide { grid-column: span 3; }
    .aigw-stations { grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr)); }
    .aigw-station.feature { grid-column: auto; }
    .aigw-anchors { grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr)); }
    .aigw-causal-cols { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .aigw-domrow .aigw-dom {
      grid-template-columns: auto minmax(120px, 0.7fr) minmax(0, 1.5fr) auto auto;
      grid-template-areas: "ico main line stats side";
    }
    .aigw-domrow .aigw-dom-stats { justify-content: flex-end; }
  }
  @media (min-width: 900px) {
    .ai-global.gw-root { padding: 18px 28px 40px; }
    .gw-hero { padding: 28px 34px; gap: 24px; border-radius: 32px; }
    .gw-root[dir='rtl'] .gw-hero { grid-template-columns: minmax(0, 1fr) 270px; }
    .gw-root[dir='ltr'] .gw-hero { grid-template-columns: 270px minmax(0, 1fr); }
    .gw-hero-art { width: 250px; }
    .gw-hero-title { font-size: clamp(34px, 3.6vw, 50px); }
    .gw-hero-sub { font-size: 12.5px; }
    .gw-kpi b { font-size: 22px; }
    .gw-tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .gw-tile.wide { grid-column: span 2; }
    .gw-root .aig-tabs { flex-wrap: wrap; overflow: visible; justify-content: center; }
    .gw-root .aig-section { padding: 22px 24px; }
    .aigw-stations { grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); gap: 12px; }
    .aigw-gauges { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 20px; }
    .aigw-bench-body { display: grid; grid-template-columns: 1.1fr 1fr; gap: 6px 22px; }
    .aigw-bench-body > p:first-child { grid-column: 1 / -1; }
    .aigw-bench-body .aigw-bench-note { grid-column: 1 / -1; }
    .aigw-bench-table { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .gw-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 26px; align-items: start; }
    .gw-col { min-width: 0; }
    .aigw-domrow .aigw-dom { padding: 16px 20px; column-gap: 18px; }
    .aigw-domrow .aigw-dom-ico { width: 44px; height: 44px; border-radius: 15px; }
    .aigw-domrow .aigw-dom-name { font-size: 14px; }
    .aigw-dom-line { font-size: 12px; }
    .aigw-dom-open { padding: 4px 20px 18px; }
    .aigw-panel.acc-globe { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 26px; align-items: start; }
    .aigw-panel.acc-globe > .aigw-globe-wrap { grid-column: 1; grid-row: 1; margin-inline: auto; width: 100%; }
    .aigw-panel.acc-globe > .aigw-globe-legend { grid-column: 1; grid-row: 2; }
    .aigw-panel.acc-globe > .aigw-chips { grid-column: 1; grid-row: 3; flex-wrap: wrap; overflow: visible; }
    .aigw-panel.acc-globe > .aigw-country-card { grid-column: 2; grid-row: 1 / span 3; margin-top: 0; }
    .aigw-panel.acc-globe > .aigw-note { grid-column: 1 / -1; }
    .aigw-panel.acc-dna { display: grid; grid-template-columns: minmax(0, 340px) minmax(0, 1fr); column-gap: 28px; align-items: start; }
    .aigw-panel.acc-dna > .aigw-chips { grid-column: 1 / -1; }
    .aigw-panel.acc-dna > .aigw-dna-helix { grid-column: 1; grid-row: 2; }
    .aigw-panel.acc-dna > .aigw-hex { grid-column: 1; grid-row: 3; width: 100%; }
    .aigw-panel.acc-dna > .aig-section { grid-column: 2; grid-row: 2 / span 2; }
    .aigw-panel.acc-dna > .aigw-note, .aigw-panel.acc-dna > .aig-empty { grid-column: 1 / -1; }
    .aigw-prov-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 14px; }
  }
  @media (min-width: 1280px) {
    .gw-tiles { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    .gw-tile.wide { grid-column: span 2; }
    .aigw-stations { grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr)); }
    .gw-hero-art { width: 280px; }
    .gw-root[dir='rtl'] .gw-hero { grid-template-columns: minmax(0, 1fr) 300px; }
    .gw-root[dir='ltr'] .gw-hero { grid-template-columns: 300px minmax(0, 1fr); }
  }
  @media (max-width: 420px) {
    .gw-hero-art { width: 84px; }
    .gw-tile-value .gw-v { font-size: 19px; }
    .gw-tile.wide .gw-tile-value .gw-v { font-size: 30px; }
    .aigw-bench-bands { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .aigw-bench-table { grid-template-columns: 1fr; }
  }

  /* ══ light theme ══════════════════════════════════════════════════════ */
  :root[data-theme='light'] .gw-hero { background:
      radial-gradient(120% 140% at 100% 0%, color-mix(in srgb, var(--rgb-2) 14%, transparent), transparent 58%),
      radial-gradient(120% 140% at 0% 100%, color-mix(in srgb, var(--rgb-1) 12%, transparent), transparent 60%), #ffffff;
    border-color: rgba(13,16,32,0.12); box-shadow: 0 24px 50px -40px rgba(13,16,32,0.4); }
  :root[data-theme='light'] .gw-hero-glow { opacity: .16; }
  :root[data-theme='light'] .gw-kpi, :root[data-theme='light'] .gw-eyebrow { background: rgba(13,16,32,0.035); border-color: rgba(13,16,32,0.1); }
  :root[data-theme='light'] .gw-tile, :root[data-theme='light'] .gw-msg, :root[data-theme='light'] .aigw-anchor, :root[data-theme='light'] .aigw-domrow {
    background: #ffffff; border-color: rgba(13,16,32,0.1); }
  :root[data-theme='light'] .gw-tile { border-color: color-mix(in srgb, var(--tone) 38%, rgba(13,16,32,0.1)); }
  :root[data-theme='light'] .aigw-bench { background: #ffffff; border-color: rgba(13,16,32,0.1); }
  :root[data-theme='light'] .aigw-adv-opp { background: rgba(13,16,32,0.03); }
  :root[data-theme='light'] .aigw-ev, :root[data-theme='light'] .aigw-dom-stat, :root[data-theme='light'] .aigw-sum-chip { background: rgba(13,16,32,0.04); }

  /* ══ motion off ═══════════════════════════════════════════════════════ */
  @media (prefers-reduced-motion: reduce) {
    .gw-hero-glow, .gw-orbital .gw-spin, .gw-orbital .gw-sweep, .gw-orbital .gw-pulse, .gw-orbital .gw-land, .gw-orbital .gw-tw,
    .gw-live::after, .gw-hero-title::before, .aigw-dom-open { animation: none; }
    .gw-tile, .gw-msg, .gw-tile-go, .aigw-domrow, .aigw-dom-caret, .aigw-bench-caret, .gw-hero-refresh, .gw-hero-refresh-hint { transition: none; }
    .gw-tile:hover, .gw-msg:hover, .gw-tile:active, .gw-hero-refresh:hover:not(:disabled), .gw-hero-refresh:active:not(:disabled) { transform: none; }
    .gw-orbital .gw-tw { opacity: .7; }
  }
`;
