/**
 * FBT WORLD CONSOLE — the visual system of the «FBT جهانی» upgrade.
 * ---------------------------------------------------------------------------
 * REPORTED (2026-10): «ایکون انیمیشن انگار یک صفحه هواشناسی جذابه… رنگ درست نه
 * فقط بنفش… فاصله و اندازه درست… تم درست».
 *
 * So the sheet is TOKENISED per panel: every console panel declares its own
 * accent pair (--acc1 / --acc2) and the material below reads only those —
 * cyan for the weather board, azure/emerald for the globe, phosphor green for
 * the radar, amber for the economy, teal for capital flows, orange-rose for
 * the causal chain, lime for the future tree, fuchsia for DNA, blue for the
 * domains and steel-blue for providers. The app's global violet is still
 * available (var(--rgb-2)) where a neutral accent is wanted; nothing here is
 * hard-coded to it.
 *
 * Everything is inline SVG + CSS transforms: no images, no tiles, no network.
 * Light and dark themes are both first-class, and every animation is switched
 * off under prefers-reduced-motion.
 */
export const WORLD_STYLES = `
  /* ══ tokens ═════════════════════════════════════════════════════════════ */
  .aigw-panel {
    --acc1: var(--rgb-1); --acc2: var(--rgb-2);
    --acc-soft: color-mix(in srgb, var(--acc1) 14%, transparent);
    --acc-line: color-mix(in srgb, var(--acc1) 34%, transparent);
    --acc-grad: linear-gradient(135deg, var(--acc1), var(--acc2));
    --gap: 12px;
    display: block;
  }
  .aigw-panel.acc-weather { --acc1: #22d3ee; --acc2: #34d399; }
  .aigw-panel.acc-globe   { --acc1: #38bdf8; --acc2: #818cf8; }
  .aigw-panel.acc-radar   { --acc1: #4ade80; --acc2: #facc15; }
  .aigw-panel.acc-econ    { --acc1: #fbbf24; --acc2: #f472b6; }
  .aigw-panel.acc-flows   { --acc1: #2dd4bf; --acc2: #22d3ee; }
  .aigw-panel.acc-causal  { --acc1: #fb923c; --acc2: #f472b6; }
  .aigw-panel.acc-future  { --acc1: #a3e635; --acc2: #22d3ee; }
  .aigw-panel.acc-dna     { --acc1: #e879f9; --acc2: #38bdf8; }
  .aigw-panel.acc-domains { --acc1: #60a5fa; --acc2: #a78bfa; }
  .aigw-panel.acc-prov    { --acc1: #7dd3fc; --acc2: #94a3b8; }

  .aigw-icon { flex: 0 0 auto; display: inline-block; vertical-align: -3px; }
  .aigw-dir { flex: 0 0 auto; display: inline-block; vertical-align: -1px; }
  .aigw-dir-up { color: var(--up); } .aigw-dir-down { color: var(--down); } .aigw-dir-flat { color: var(--text-3); }
  .aigw-ltr { direction: ltr; unicode-bidi: embed; font-variant-numeric: tabular-nums; }

  /* ══ headings + notes ══════════════════════════════════════════════════ */
  .aigw-sec {
    display: flex; align-items: center; gap: 9px;
    margin: 18px 0 9px; font-size: 12.5px; font-weight: 900; color: var(--text-1);
    line-height: 1.6;
  }
  .aigw-sec:first-child { margin-top: 2px; }
  .aigw-sec::before {
    content: ''; width: 4px; height: 17px; border-radius: 999px;
    background: var(--acc-grad); box-shadow: 0 0 12px -2px color-mix(in srgb, var(--acc1) 80%, transparent);
  }
  .aigw-sec-sub { font-size: 10px; font-weight: 700; color: var(--text-3); margin-inline-start: auto; }
  .aigw-note { font-size: 10px; color: var(--text-3); line-height: 1.9; margin-top: 10px; }
  .aigw-hint { display: inline-flex; align-items: center; gap: 6px; font-size: 10px; color: var(--text-3); }

  /* ══ chips + pills ═════════════════════════════════════════════════════ */
  .aigw-chips { display: flex; gap: 7px; overflow-x: auto; padding: 2px 1px 6px; scrollbar-width: none; }
  .aigw-chips::-webkit-scrollbar { display: none; }
  .aigw-chip {
    flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 11px; border-radius: 999px; cursor: pointer; font: inherit;
    font-size: 11px; font-weight: 800; color: var(--text-2);
    border: 1px solid color-mix(in srgb, var(--line) 80%, transparent);
    background: linear-gradient(160deg, rgba(255,255,255,0.045), rgba(255,255,255,0.008)), var(--bg-raised);
    transition: color .2s, border-color .2s, transform .2s, background .2s;
  }
  .aigw-chip:hover { color: var(--text-1); transform: translateY(-1px); }
  .aigw-chip.active {
    color: var(--text-1); border-color: color-mix(in srgb, var(--acc1) 52%, transparent);
    background: linear-gradient(140deg, color-mix(in srgb, var(--acc1) 20%, var(--bg-panel-solid)), color-mix(in srgb, var(--acc2) 18%, var(--bg-panel-solid)));
    box-shadow: 0 12px 24px -18px color-mix(in srgb, var(--acc1) 90%, transparent);
  }
  .aigw-pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 10px; font-weight: 850; white-space: nowrap; }
  .aigw-pill.up { color: var(--up); background: color-mix(in srgb, var(--up) 12%, transparent); border: 1px solid color-mix(in srgb, var(--up) 30%, transparent); }
  .aigw-pill.down { color: var(--down); background: color-mix(in srgb, var(--down) 12%, transparent); border: 1px solid color-mix(in srgb, var(--down) 30%, transparent); }
  .aigw-pill.flat { color: var(--text-2); background: color-mix(in srgb, var(--rgb-5) 10%, transparent); border: 1px solid color-mix(in srgb, var(--rgb-5) 26%, transparent); }
  .aigw-pill.warn { color: var(--rgb-5); background: color-mix(in srgb, var(--rgb-5) 11%, transparent); border: 1px solid color-mix(in srgb, var(--rgb-5) 28%, transparent); }
  .aigw-pill.bad { color: var(--down); background: color-mix(in srgb, var(--down) 11%, transparent); border: 1px solid color-mix(in srgb, var(--down) 28%, transparent); }
  .aigw-pill.info { color: var(--acc1); background: color-mix(in srgb, var(--acc1) 12%, transparent); border: 1px solid color-mix(in srgb, var(--acc1) 30%, transparent); }
  .aigw-pill.ghost { color: var(--text-3); background: transparent; border: 1px dashed color-mix(in srgb, var(--line) 90%, transparent); }
  .aigw-tag {
    display: inline-flex; align-items: center; gap: 5px; font-size: 9.5px; font-weight: 800;
    padding: 4px 8px; border-radius: 9px; color: var(--text-2);
    background: color-mix(in srgb, var(--acc1) 9%, transparent);
    border: 1px solid color-mix(in srgb, var(--acc1) 22%, transparent);
  }
  .aigw-tag b { font-weight: 950; color: var(--text-1); }

  /* ══ the weather board ═════════════════════════════════════════════════ */
  .aigw-climate {
    position: relative; overflow: hidden; margin-top: 2px; padding: 16px;
    border-radius: 22px; border: 1px solid var(--acc-line);
    background:
      radial-gradient(120% 140% at 12% 0%, color-mix(in srgb, var(--acc1) 20%, transparent), transparent 60%),
      radial-gradient(120% 140% at 95% 100%, color-mix(in srgb, var(--acc2) 16%, transparent), transparent 62%),
      var(--bg-raised);
  }
  .aigw-climate-main { display: flex; align-items: center; gap: 14px; }
  .aigw-climate-copy { min-width: 0; flex: 1; }
  .aigw-climate-kicker { font-size: 10px; letter-spacing: .4px; font-weight: 850; color: var(--text-3); }
  .aigw-climate-label { margin-top: 3px; font-size: 19px; font-weight: 950; color: var(--text-1); line-height: 1.35; }
  .aigw-climate-sub { margin-top: 4px; font-size: 10.5px; color: var(--text-2); line-height: 1.8; overflow-wrap: anywhere; }
  .aigw-climate-index { display: flex; align-items: baseline; gap: 4px; font-variant-numeric: tabular-nums; }
  .aigw-climate-index b { font-size: 26px; font-weight: 950; color: var(--text-1); direction: ltr; }
  .aigw-climate-index span { font-size: 10px; color: var(--text-3); }
  .aigw-climate-bar { position: relative; height: 8px; margin-top: 13px; border-radius: 999px; direction: ltr; overflow: hidden;
    background: linear-gradient(90deg, color-mix(in srgb, var(--down) 55%, transparent), color-mix(in srgb, var(--rgb-5) 45%, transparent), color-mix(in srgb, var(--up) 55%, transparent)); opacity: .9; }
  .aigw-climate-bar i { position: absolute; inset-block: -3px; width: 3px; border-radius: 999px; background: #fff; box-shadow: 0 0 10px #fff;
    transition: inset-inline-start .8s cubic-bezier(.3,.7,.2,1); direction: ltr; }
  .aigw-climate-parts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }

  .aigw-glyph { position: relative; display: grid; place-items: center; flex: 0 0 auto; }
  .aigw-glyph svg { display: block; }

  .aigw-stations { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-top: 10px; }
  .aigw-station {
    position: relative; overflow: hidden; padding: 13px 13px 12px; border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
    background: linear-gradient(165deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01)), var(--bg-raised);
    transition: transform .25s cubic-bezier(.4,0,.2,1), border-color .25s, box-shadow .25s;
  }
  .aigw-station:hover { transform: translateY(-2px); border-color: var(--acc-line); box-shadow: 0 18px 34px -28px color-mix(in srgb, var(--acc1) 90%, transparent); }
  .aigw-station-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .aigw-station-name { font-size: 11px; font-weight: 850; color: var(--text-1); line-height: 1.5; }
  .aigw-station-cond { margin-top: 3px; font-size: 9.5px; font-weight: 800; color: var(--text-3); }
  .aigw-station-val { margin-top: 8px; font-size: 17px; font-weight: 950; color: var(--text-1); direction: ltr; font-variant-numeric: tabular-nums; }
  .aigw-station-ev { margin-top: 5px; font-size: 9.5px; color: var(--text-3); line-height: 1.75; overflow-wrap: anywhere; }
  .aigw-station .aigw-dial { margin-top: 8px; }
  .aigw-station.tone-sun { border-color: color-mix(in srgb, var(--up) 26%, var(--line)); }
  .aigw-station.tone-rain, .aigw-station.tone-storm { border-color: color-mix(in srgb, var(--down) 26%, var(--line)); }
  .aigw-station.tone-windy { border-color: color-mix(in srgb, var(--rgb-5) 28%, var(--line)); }
  .aigw-station.feature { grid-column: 1 / -1; padding: 15px; }
  .aigw-station.feature .aigw-station-name { font-size: 12.5px; }
  .aigw-station.feature .aigw-station-val { font-size: 22px; }
  .aigw-station.feature .aigw-station-top { align-items: center; }
  .aigw-station.feature .aigw-glyph { filter: drop-shadow(0 10px 22px color-mix(in srgb, var(--acc1) 40%, transparent)); }

  .aigw-dial { position: relative; height: 5px; border-radius: 999px; direction: ltr; overflow: hidden;
    background: color-mix(in srgb, var(--text-1) 10%, transparent); }
  .aigw-dial i { position: absolute; inset-block: 0; inset-inline-start: 0; border-radius: 999px; background: var(--acc-grad);
    transition: width .8s cubic-bezier(.3,.7,.2,1); }
  .aigw-station.tone-sun .aigw-dial i { background: linear-gradient(90deg, color-mix(in srgb, var(--up) 70%, var(--acc1)), var(--up)); }
  .aigw-station.tone-rain .aigw-dial i, .aigw-station.tone-storm .aigw-dial i { background: linear-gradient(90deg, var(--rgb-5), var(--down)); }
  .aigw-station.tone-windy .aigw-dial i { background: linear-gradient(90deg, var(--rgb-5), color-mix(in srgb, var(--rgb-5) 40%, var(--acc1))); }

  /* the legacy hourly strip (kept: the probe and the phone layout read it) */
  .aigw-weather { display: flex; gap: 8px; overflow-x: auto; padding: 2px 1px 6px; scrollbar-width: none; }
  .aigw-weather::-webkit-scrollbar { display: none; }
  .aigw-weather-card {
    flex: 0 0 auto; width: 96px; padding: 12px 8px 10px; text-align: center; border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--line) 75%, transparent);
    background: linear-gradient(170deg, rgba(255,255,255,0.045), rgba(255,255,255,0.01)), var(--bg-raised);
    transition: transform .25s cubic-bezier(.4,0,.2,1), border-color .25s;
  }
  .aigw-weather-card:hover { transform: translateY(-2px); }
  .aigw-weather-card.tone-sun { border-color: color-mix(in srgb, var(--up) 30%, var(--line)); }
  .aigw-weather-card.tone-rain, .aigw-weather-card.tone-storm { border-color: color-mix(in srgb, var(--down) 30%, var(--line)); }
  .aigw-weather-card.tone-windy { border-color: color-mix(in srgb, var(--rgb-5) 32%, var(--line)); }
  .aigw-weather-icon { display: grid; place-items: center; width: 44px; height: 44px; margin: 0 auto 8px; border-radius: 14px;
    color: var(--acc1); background: color-mix(in srgb, var(--acc1) 10%, transparent); }
  .aigw-weather-card.tone-sun .aigw-weather-icon { color: var(--up); background: color-mix(in srgb, var(--up) 11%, transparent); }
  .aigw-weather-card.tone-rain .aigw-weather-icon, .aigw-weather-card.tone-storm .aigw-weather-icon { color: var(--down); background: color-mix(in srgb, var(--down) 11%, transparent); }
  .aigw-weather-card.tone-windy .aigw-weather-icon { color: var(--rgb-5); background: color-mix(in srgb, var(--rgb-5) 11%, transparent); }
  .aigw-weather-name { font-size: 10px; font-weight: 800; color: var(--text-2); line-height: 1.5; }
  .aigw-weather-val { margin-top: 4px; font-size: 11px; font-weight: 900; color: var(--text-1); direction: ltr; }

  /* ══ gauges ════════════════════════════════════════════════════════════ */
  .aigw-gauge {
    display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 11px;
    padding: 11px 12px; margin-bottom: 8px; border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--line) 74%, transparent);
    background: linear-gradient(160deg, rgba(255,255,255,0.04), rgba(255,255,255,0.008)), var(--bg-raised);
    transition: border-color .22s, transform .22s;
  }
  .aigw-gauge:hover { border-color: var(--acc-line); transform: translateX(-1px); }
  .aigw-gauge-icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; color: var(--acc1);
    background: linear-gradient(140deg, color-mix(in srgb, var(--acc1) 14%, transparent), color-mix(in srgb, var(--acc2) 12%, transparent)); }
  .aigw-gauge-name { font-size: 11.5px; font-weight: 850; color: var(--text-1); line-height: 1.55; }
  .aigw-gauge-ev { margin-top: 3px; font-size: 10px; color: var(--text-3); line-height: 1.7; overflow-wrap: anywhere; }
  .aigw-gauge-side { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
  .aigw-gauge-meter { display: flex; gap: 3px; direction: ltr; }
  .aigw-gauge-meter i { width: 13px; height: 5px; border-radius: 999px; background: color-mix(in srgb, var(--text-1) 11%, transparent); }
  .aigw-gauge-meter i.on { background: var(--acc-grad); box-shadow: 0 0 8px -2px color-mix(in srgb, var(--acc1) 75%, transparent); }
  .aigw-gauge-meter i.on.bad { background: linear-gradient(90deg, var(--down), color-mix(in srgb, var(--down) 60%, var(--rgb-5))); }

  .aigw-ribbon {
    display: flex; align-items: center; gap: 9px; margin-top: 12px; padding: 12px 13px; border-radius: 16px; cursor: pointer;
    border: 1px solid var(--acc-line);
    background: linear-gradient(140deg, color-mix(in srgb, var(--acc1) 10%, transparent), color-mix(in srgb, var(--acc2) 10%, transparent));
    font: inherit; text-align: start; width: 100%; transition: transform .2s, filter .2s;
  }
  .aigw-ribbon:hover { filter: brightness(1.07); transform: translateY(-1px); }
  .aigw-ribbon-dots { display: flex; gap: 7px; align-items: center; }
  .aigw-ribbon-dots b { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 850; color: var(--text-2); }

  /* ══ tone dots (shared by radar + globe + lists) ═══════════════════════ */
  .aigw-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: 0 0 auto; }
  .aigw-dot.t-critical { background: #ef4444; box-shadow: 0 0 8px rgba(239,68,68,.7); }
  .aigw-dot.t-emerging { background: #f97316; box-shadow: 0 0 8px rgba(249,115,22,.6); }
  .aigw-dot.t-developing { background: #eab308; box-shadow: 0 0 8px rgba(234,179,8,.5); }
  .aigw-dot.t-stable { background: #22c55e; }
  .aigw-dot.t-opportunity { background: #38bdf8; box-shadow: 0 0 8px rgba(56,189,248,.6); }

  /* ══ the 3-D globe ═════════════════════════════════════════════════════ */
  .aigw-globe-wrap {
    position: relative; width: 100%; max-width: 380px; margin-inline: auto;
    border-radius: 26px; overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--acc1) 22%, var(--line));
    background:
      radial-gradient(120% 110% at 30% 8%, color-mix(in srgb, var(--acc1) 16%, transparent), transparent 58%),
      radial-gradient(120% 120% at 80% 100%, color-mix(in srgb, var(--acc2) 14%, transparent), transparent 60%),
      var(--bg-panel-solid);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 30px 60px -50px color-mix(in srgb, var(--acc1) 90%, transparent);
  }
  .aigw-globe { display: block; width: 100%; height: auto; touch-action: none; cursor: grab; }
  .aigw-globe.dragging { cursor: grabbing; }
  .aigw-globe-svg { position: absolute; inset: 0; pointer-events: none; }
  .aigw-orbit-a, .aigw-orbit-b { transform-origin: 50% 50%; transform-box: view-box; }
  .aigw-orbit-a { animation: aigw-orbit 44s linear infinite; }
  .aigw-orbit-b { animation: aigw-orbit 68s linear infinite reverse; }
  @keyframes aigw-orbit { to { transform: rotate(360deg); } }
  .aigw-globe-hud { position: absolute; inset-block-start: 10px; inset-inline: 10px; display: flex; gap: 6px; flex-wrap: wrap; pointer-events: none; }
  .aigw-globe-hud .aigw-pill { backdrop-filter: blur(6px); background-color: color-mix(in srgb, var(--bg-panel-solid) 72%, transparent); }
  .aigw-globe-legend { display: flex; align-items: center; gap: 8px; margin-top: 9px; flex-wrap: wrap; }
  .aigw-globe-dot { scroll-margin-inline: 60px; }
  .aigw-country-card {
    margin-top: 12px; padding: 14px; border-radius: 18px;
    border: 1px solid var(--acc-line);
    background: linear-gradient(150deg, color-mix(in srgb, var(--acc1) 9%, transparent), rgba(255,255,255,0.012)), var(--bg-raised);
    animation: aigw-rise .35s cubic-bezier(.3,.7,.2,1);
  }
  @keyframes aigw-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .aigw-country-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .aigw-country-name { display: flex; align-items: center; gap: 7px; font-size: 13.5px; font-weight: 900; color: var(--text-1); }
  .aigw-country-sum { font-size: 10px; color: var(--text-2); line-height: 1.9; margin-bottom: 4px; }
  .aigw-country-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 9px 0; border-top: 1px solid color-mix(in srgb, var(--line) 62%, transparent); }
  .aigw-country-sym { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 850; color: var(--text-1); }
  .aigw-country-sub { font-size: 9.5px; color: var(--text-3); margin-top: 3px; overflow-wrap: anywhere; line-height: 1.7; }
  .aigw-country-bar { position: relative; width: 96px; height: 6px; border-radius: 99px; direction: ltr;
    background: color-mix(in srgb, var(--text-1) 10%, transparent); overflow: hidden; }
  .aigw-country-bar i { position: absolute; top: 0; bottom: 0; border-radius: 99px; transition: width .5s cubic-bezier(.4,0,.2,1); }
  .aigw-country-bar i.up { inset-inline-start: 50%; background: var(--up); }
  .aigw-country-bar i.down { inset-inline-end: 50%; background: var(--down); }
  .aigw-country-val { font-size: 11px; font-weight: 900; color: var(--text-1); min-width: 56px; text-align: end; }

  /* ══ radar ═════════════════════════════════════════════════════════════ */
  .aigw-radar-wrap { position: relative; display: grid; place-items: center; }
  .aigw-radar-scope {
    position: relative; width: 100%; max-width: 340px; padding: 10px; border-radius: 24px;
    border: 1px solid color-mix(in srgb, var(--acc1) 24%, var(--line));
    background:
      radial-gradient(120% 120% at 50% 0%, color-mix(in srgb, var(--acc1) 12%, transparent), transparent 62%),
      var(--bg-panel-solid);
  }
  .aigw-radar { width: 100%; height: auto; display: block; }
  .aigw-sweep { transform-origin: 50% 50%; transform-box: view-box; animation: aigw-sweep 4.6s linear infinite; }
  .aigw-sweep-slow { transform-origin: 50% 50%; transform-box: view-box; animation: aigw-sweep 9.2s linear infinite reverse; opacity: .35; }
  @keyframes aigw-sweep { to { transform: rotate(360deg); } }
  .aigw-blip { cursor: pointer; }
  .aigw-blip circle.b-core { transition: r .18s ease; }
  .aigw-blip:hover circle.b-core { r: 6.5; }
  .aigw-blip-ping { transform-origin: 50% 50%; transform-box: fill-box; animation: aigw-halo 1.9s ease-out infinite; }
  @keyframes aigw-halo { 0% { opacity: .55; transform: scale(.5); } 100% { opacity: 0; transform: scale(1.9); } }
  .aigw-blip-detail {
    margin-top: 11px; padding: 12px 13px; border-radius: 16px;
    border: 1px solid var(--acc-line);
    background: linear-gradient(160deg, color-mix(in srgb, var(--acc1) 8%, transparent), rgba(255,255,255,0.008)), var(--bg-raised);
    animation: aigw-rise .3s cubic-bezier(.3,.7,.2,1);
  }
  .aigw-tape { max-height: 292px; overflow-y: auto; margin-top: 10px; padding-inline-end: 2px; }
  .aigw-tape-row {
    display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; align-items: center; gap: 9px;
    width: 100%; padding: 9px 10px; margin-bottom: 6px; border-radius: 13px; font: inherit; text-align: start; cursor: pointer;
    border: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
    background: linear-gradient(160deg, rgba(255,255,255,0.032), rgba(255,255,255,0.006)), var(--bg-raised);
    transition: border-color .2s, transform .2s;
  }
  .aigw-tape-row:hover { transform: translateX(-2px); border-color: var(--acc-line); }
  .aigw-tape-row.active { border-color: var(--acc-line); box-shadow: 0 12px 26px -24px color-mix(in srgb, var(--acc1) 90%, transparent); }
  .aigw-tape-title { font-size: 10.5px; font-weight: 800; color: var(--text-1); line-height: 1.6; overflow-wrap: anywhere; }
  .aigw-tape-sub { font-size: 9px; color: var(--text-3); margin-top: 2px; }
  .aigw-tape-val { font-size: 10.5px; font-weight: 900; color: var(--text-2); direction: ltr; }

  /* ══ causal chain ══════════════════════════════════════════════════════ */
  .aigw-chain { margin: 10px 0 4px; }
  .aigw-chain-node {
    position: relative; display: flex; align-items: center; gap: 10px;
    padding: 11px 13px; border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--line) 74%, transparent);
    background: linear-gradient(160deg, rgba(255,255,255,0.042), rgba(255,255,255,0.008)), var(--bg-raised);
  }
  .aigw-chain-node.state-read { border-color: color-mix(in srgb, var(--acc1) 30%, var(--line)); }
  .aigw-chain-node.state-proxy { border-style: dashed; }
  .aigw-chain-node.state-model { border-color: color-mix(in srgb, var(--rgb-5) 30%, var(--line)); }
  .aigw-chain-node.state-unread { opacity: .72; }
  .aigw-chain-ico { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; flex: 0 0 auto;
    color: var(--acc1); background: color-mix(in srgb, var(--acc1) 11%, transparent); }
  .aigw-chain-arrow { display: grid; place-items: center; height: 26px; color: var(--text-3); position: relative; }
  .aigw-chain-arrow.lit { color: var(--acc2); }
  .aigw-chain-arrow.lit::before {
    content: ''; position: absolute; inset-inline-start: 50%; top: 0; bottom: 0; width: 2px; margin-inline-start: -1px; border-radius: 99px;
    background: linear-gradient(180deg, transparent, var(--acc2));
    animation: aigw-fall 1.8s ease-in-out infinite;
  }
  @keyframes aigw-fall { 0% { opacity: 0; transform: translateY(-6px); } 45% { opacity: .9; } 100% { opacity: 0; transform: translateY(7px); } }
  .aigw-causal-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 10px 0; }
  .aigw-causal-col { min-width: 0; }
  .aigw-causal-col h4 { margin: 0 0 6px; font-size: 10px; font-weight: 900; color: var(--text-3); letter-spacing: .2px; }
  .aigw-node-chip {
    display: flex; align-items: center; gap: 7px; padding: 8px 9px; margin-bottom: 6px; border-radius: 12px;
    font-size: 10.5px; color: var(--text-2);
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
    background: linear-gradient(160deg, rgba(255,255,255,0.03), rgba(255,255,255,0.006)), var(--bg-raised);
  }
  .aigw-node-chip.risk-up { border-color: color-mix(in srgb, var(--down) 32%, var(--line)); }
  .aigw-node-chip.risk-down { border-color: color-mix(in srgb, var(--up) 32%, var(--line)); }
  .aigw-driver { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid color-mix(in srgb, var(--line) 62%, transparent); }
  .aigw-driver-bar { position: relative; width: 56px; height: 6px; border-radius: 99px; flex: 0 0 auto; direction: ltr;
    background: color-mix(in srgb, var(--text-1) 10%, transparent); overflow: hidden; }
  .aigw-driver-bar i { position: absolute; inset-block: 0; border-radius: 99px; }

  /* ══ capital flow ══════════════════════════════════════════════════════ */
  .aigw-flow-hero {
    display: flex; align-items: center; gap: 14px; padding: 15px; border-radius: 20px;
    border: 1px solid var(--acc-line);
    background:
      radial-gradient(120% 130% at 8% 0%, color-mix(in srgb, var(--acc1) 18%, transparent), transparent 58%),
      var(--bg-raised);
  }
  .aigw-flow-hero-val { font-size: 24px; font-weight: 950; color: var(--text-1); direction: ltr; font-variant-numeric: tabular-nums; }
  .aigw-flow-hero-k { font-size: 10px; font-weight: 850; color: var(--text-3); }
  .aigw-flow-hero-sub { margin-top: 4px; font-size: 10px; color: var(--text-2); line-height: 1.8; }
  .aigw-flow-node {
    position: relative; display: flex; align-items: center; gap: 11px; padding: 12px 13px; border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--line) 74%, transparent);
    background: linear-gradient(160deg, rgba(255,255,255,0.042), rgba(255,255,255,0.008)), var(--bg-raised);
    transition: border-color .25s, transform .25s;
  }
  .aigw-flow-node.on { border-color: var(--acc-line); box-shadow: 0 14px 30px -26px color-mix(in srgb, var(--acc1) 85%, transparent); }
  .aigw-flow-node:hover { transform: translateX(-2px); }
  .aigw-flow-ico { position: relative; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; flex: 0 0 auto; color: #fff;
    background: var(--acc-grad); box-shadow: 0 0 20px -8px color-mix(in srgb, var(--acc1) 85%, transparent); }
  .aigw-flow-node:not(.on) .aigw-flow-ico { filter: grayscale(.85) brightness(.75); box-shadow: none; }
  .aigw-flow-conn { position: relative; height: 32px; width: 3px; margin: 0 auto; border-radius: 99px;
    background: color-mix(in srgb, var(--text-1) 13%, transparent); overflow: hidden; }
  .aigw-flow-conn.on::after {
    content: ''; position: absolute; inset-inline: 0; height: 12px; border-radius: 99px;
    background: linear-gradient(180deg, var(--acc1), var(--acc2));
    animation: aigw-fallconn 1.7s cubic-bezier(.4,0,.6,1) infinite;
  }
  @keyframes aigw-fallconn { 0% { top: -12px; opacity: 0; } 30% { opacity: 1; } 100% { top: 32px; opacity: 0; } }
  .aigw-flow-chevron { display: grid; place-items: center; height: 0; color: var(--text-3); }
  .aigw-flow-chevron svg { transform: translateY(-3px); opacity: .8; }
  .aigw-leader { display: grid; grid-template-columns: minmax(0,1fr) auto auto; gap: 9px; align-items: center;
    padding: 9px 11px; margin-bottom: 6px; border-radius: 13px;
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
    background: linear-gradient(160deg, rgba(255,255,255,0.03), rgba(255,255,255,0.006)), var(--bg-raised); }
  .aigw-leader-sym { font-size: 11px; font-weight: 900; color: var(--text-1); display: flex; align-items: center; gap: 6px; }
  .aigw-leader-name { font-size: 9px; color: var(--text-3); margin-top: 2px; }
  .aigw-leader-val { font-size: 11px; font-weight: 900; direction: ltr; }
  .aigw-leader-pct { font-size: 10px; font-weight: 850; direction: ltr; }
  .aigw-bar { position: relative; height: 6px; border-radius: 99px; direction: ltr; overflow: hidden;
    background: color-mix(in srgb, var(--text-1) 10%, transparent); }
  .aigw-bar i { position: absolute; inset-block: 0; border-radius: 99px; transition: width .6s cubic-bezier(.3,.7,.2,1); }

  /* ══ future tree ═══════════════════════════════════════════════════════ */
  .aigw-tree-root { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 15px;
    border: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
    background: linear-gradient(160deg, rgba(255,255,255,0.035), rgba(255,255,255,0.006)), var(--bg-raised); }
  :root[data-theme='light'] .aigw-tree-root { background: #ffffff; border-color: rgba(13,16,32,0.1); }
  .aigw-tree-stage { position: relative; display: grid; place-items: center; margin: 4px 0 10px; }
  .aigw-tree-svg { width: 100%; max-width: 340px; height: auto; }
  .aigw-branch-tree-path { stroke-dasharray: 240; stroke-dashoffset: 240; animation: aigw-grow 1.5s cubic-bezier(.3,.7,.2,1) forwards; }
  .aigw-branch-tree-path.d1 { animation-delay: .18s; }
  .aigw-branch-tree-path.d2 { animation-delay: .34s; }
  @keyframes aigw-grow { to { stroke-dashoffset: 0; } }
  .aigw-leaf { transform-origin: 50% 50%; transform-box: fill-box; animation: aigw-leaf 3.4s ease-in-out infinite; }
  .aigw-leaf.d1 { animation-delay: .5s; } .aigw-leaf.d2 { animation-delay: 1s; } .aigw-leaf.d3 { animation-delay: 1.6s; }
  @keyframes aigw-leaf { 0%,100% { transform: scale(1); opacity: .85; } 50% { transform: scale(1.16); opacity: 1; } }
  .aigw-branch {
    position: relative; padding: 12px 13px 13px 15px; margin-bottom: 9px; border-radius: 16px; overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--line) 76%, transparent);
    background: linear-gradient(160deg, rgba(255,255,255,0.042), rgba(255,255,255,0.008)), var(--bg-raised);
  }
  .aigw-branch::before { content: ''; position: absolute; inset-block: 0; inset-inline-start: 0; width: 3px; border-radius: 99px; background: var(--branch-tone, var(--acc2)); }
  .aigw-branch-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .aigw-branch-name { display: flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 900; color: var(--text-1); }
  .aigw-branch-weight { font-size: 17px; font-weight: 950; color: var(--branch-tone, var(--acc2)); direction: ltr; font-variant-numeric: tabular-nums; }
  .aigw-branch-bar { position: relative; height: 7px; border-radius: 99px; margin: 9px 0 8px; direction: ltr;
    background: color-mix(in srgb, var(--text-1) 10%, transparent); overflow: hidden; }
  .aigw-branch-bar i { position: absolute; inset-block: 0; inset-inline-start: 0; border-radius: 99px; background: var(--branch-tone, var(--acc2));
    transition: width .7s cubic-bezier(.3,.7,.2,1); }
  .aigw-driver-tags { display: flex; flex-wrap: wrap; gap: 5px; }
  .aigw-flip { display: flex; gap: 8px; align-items: flex-start; padding: 8px 0; border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }
  .aigw-flip-t { font-size: 10.5px; font-weight: 800; color: var(--text-1); line-height: 1.7; }
  .aigw-flip-r { font-size: 9.5px; color: var(--text-3); direction: ltr; }
  .aigw-adv { margin-top: 13px; padding: 14px; border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--down) 26%, var(--line));
    background: linear-gradient(155deg, color-mix(in srgb, var(--down) 8%, transparent), rgba(255,255,255,0.01)); }
  .aigw-adv-row { display: flex; gap: 9px; align-items: flex-start; padding: 8px 0; border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }
  .aigw-adv-row:first-of-type { border-top: none; }
  .aigw-adv-ico { flex: 0 0 auto; margin-top: 1px; }
  .aigw-adv-ico.observed { color: var(--down); }
  .aigw-adv-ico.standing { color: var(--text-3); }
  .aigw-adv-title { font-size: 11px; font-weight: 850; color: var(--text-1); line-height: 1.6; }
  .aigw-adv-ev { font-size: 10px; color: var(--text-3); line-height: 1.7; overflow-wrap: anywhere; }

  /* ══ DNA ═══════════════════════════════════════════════════════════════ */
  .aigw-dna-helix { display: block; width: 100%; height: 60px; margin: 2px 0 8px; overflow: visible;
    animation: aigw-helixbreathe 7.5s ease-in-out infinite; }
  /* the strands FLOW (dash offset) and counter-flow, the rungs pulse — the
     helix used to be a still drawing with an empty keyframe, which is exactly
     the «انیمیشن حرکتی ندارد» the report named. */
  .aigw-helix-a, .aigw-helix-b { stroke-dasharray: 22 12; animation: aigw-helixflow 2.8s linear infinite; }
  .aigw-helix-b { animation-direction: reverse; animation-delay: -1.4s; }
  @keyframes aigw-helixflow { to { stroke-dashoffset: -68; } }
  @keyframes aigw-helixbreathe { 0%,100% { transform: translateX(-1.5px); } 50% { transform: translateX(1.5px); } }
  .aigw-rung { animation: aigw-rung 3.2s ease-in-out infinite; }
  @keyframes aigw-rung { 0%,100% { opacity: .3; } 50% { opacity: .95; } }
  .aigw-dna-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 9px 0;
    border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }
  .aigw-dna-row:first-of-type { border-top: none; }
  .aigw-dna-name { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 850; color: var(--text-1); line-height: 1.5; }
  .aigw-dna-track { position: relative; height: 7px; border-radius: 99px; margin-top: 6px; direction: ltr;
    background: color-mix(in srgb, var(--text-1) 10%, transparent); overflow: hidden; }
  .aigw-dna-track i { position: absolute; inset-block: 0; inset-inline-start: 0; border-radius: 99px;
    background: var(--acc-grad); transition: width .6s cubic-bezier(.3,.7,.2,1); }
  .aigw-dna-track b { position: absolute; top: -3px; width: 2px; height: 13px; border-radius: 2px; background: #fff; box-shadow: 0 0 8px #fff;
    transition: inset-inline-start .6s cubic-bezier(.3,.7,.2,1); }
  .aigw-dna-obs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 11px; }
  .aigw-hex { display: block; width: 100%; max-width: 300px; margin: 4px auto 2px; }

  /* ══ domains + providers ═══════════════════════════════════════════════ */
  .aigw-dom-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
  .aigw-dom {
    padding: 12px; border-radius: 17px; min-width: 0;
    border: 1px solid color-mix(in srgb, var(--line) 76%, transparent);
    background: linear-gradient(165deg, rgba(255,255,255,0.045), rgba(255,255,255,0.008)), var(--bg-raised);
    transition: transform .22s, border-color .22s;
  }
  .aigw-dom:hover { transform: translateY(-2px); border-color: var(--acc-line); }
  .aigw-dom-head { display: flex; align-items: center; gap: 8px; }
  .aigw-dom-ico { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 11px; flex: 0 0 auto;
    color: var(--acc1); background: color-mix(in srgb, var(--acc1) 12%, transparent); }
  .aigw-dom-name { font-size: 11.5px; font-weight: 900; color: var(--text-1); }
  .aigw-dom-meta { font-size: 9px; color: var(--text-3); margin-top: 2px; }
  .aigw-dom-metrics { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
  .aigw-dom-metric { display: inline-flex; align-items: baseline; gap: 5px; padding: 4px 8px; border-radius: 9px; font-size: 9.5px;
    color: var(--text-2); background: color-mix(in srgb, var(--text-1) 5%, transparent); border: 1px solid color-mix(in srgb, var(--line) 70%, transparent); }
  .aigw-dom-metric b { color: var(--text-1); font-weight: 900; direction: ltr; }
  .aigw-dom-list { margin-top: 9px; }
  .aigw-dom-item { display: flex; align-items: center; gap: 7px; padding: 6px 0; border-top: 1px solid color-mix(in srgb, var(--line) 55%, transparent); font-size: 10px; color: var(--text-2); min-width: 0; }
  .aigw-dom-item b { color: var(--text-1); font-weight: 850; direction: ltr; }
  .aigw-dom-item .ell { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .aigw-prov { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 10px; align-items: center;
    padding: 11px 12px; margin-bottom: 7px; border-radius: 15px;
    border: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
    background: linear-gradient(160deg, rgba(255,255,255,0.035), rgba(255,255,255,0.006)), var(--bg-raised); }
  .aigw-lamps { display: flex; gap: 4px; direction: ltr; }
  .aigw-lamp { width: 9px; height: 9px; border-radius: 50%; background: color-mix(in srgb, var(--text-1) 12%, transparent); }
  .aigw-lamp.on { background: var(--acc1); box-shadow: 0 0 9px -1px color-mix(in srgb, var(--acc1) 90%, transparent); }
  .aigw-lamp.on.warm { background: var(--rgb-5); box-shadow: 0 0 9px -1px color-mix(in srgb, var(--rgb-5) 90%, transparent); }

  /* ══ providers: the summary line, the legend and the row anatomy ═══════ */
  .aigw-prov-sum { display: flex; align-items: baseline; gap: 9px; margin: 2px 0 10px; flex-wrap: wrap; }
  .aigw-prov-sum-n { font-size: 22px; font-weight: 950; line-height: 1; color: var(--acc1); letter-spacing: -0.02em; }
  .aigw-prov-sum-d { font-size: 10px; color: var(--text-3); line-height: 1.7; }
  .aigw-lamp-legend { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
  .aigw-lamp-legend-i { display: inline-flex; align-items: center; gap: 5px; font-size: 9px; color: var(--text-3); }
  .aigw-lamp.off { background: color-mix(in srgb, var(--text-1) 12%, transparent); box-shadow: none; }
  .aigw-prov-name { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; font-size: 11.5px; font-weight: 900; color: var(--text-1); }
  .aigw-prov-sub { font-size: 9px; color: var(--text-3); margin-top: 3px; overflow-wrap: anywhere; }
  .aigw-prov-side { display: flex; align-items: center; gap: 7px; flex-shrink: 0; }
  .aigw-prov-lit { font-size: 9.5px; font-weight: 850; color: var(--text-3); }
  @media (max-width: 380px) {
    .aigw-prov { grid-template-columns: auto minmax(0, 1fr); }
    .aigw-prov-side { grid-column: 1 / -1; justify-content: flex-end; }
  }

  /* ══ the domain cards are BUTTONS — reset, then style the selected state ═ */
  .aigw-dom { width: 100%; text-align: start; font: inherit; color: inherit; cursor: pointer; appearance: none; }
  .aigw-dom.on { border-color: var(--acc-line); box-shadow: 0 0 0 1px var(--acc-line) inset, 0 10px 26px -18px color-mix(in srgb, var(--acc1) 70%, transparent); }
  .aigw-x { display: grid; place-items: center; width: 26px; height: 26px; flex: 0 0 auto; border-radius: 9px; cursor: pointer;
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent); background: transparent; color: var(--text-3); }
  .aigw-x:hover { color: var(--text-1); border-color: var(--acc-line); }

  /* ══ the direction chip inside an outlook signal row ═══════════════════ */
  .aigw-signal-dir { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent); background: color-mix(in srgb, var(--text-1) 5%, transparent); }
  .aigw-signal-dir.up { color: var(--up); border-color: color-mix(in srgb, var(--up) 30%, transparent); }
  .aigw-signal-dir.down { color: var(--down); border-color: color-mix(in srgb, var(--down) 30%, transparent); }
  .aigw-signal-dir.neutral { color: var(--text-3); }

  /* ══ outlook (economic reading) ════════════════════════════════════════ */
  .aigw-outlook-gauge { position: relative; margin-top: 10px; }
  .aigw-outlook-arc { display: block; width: 100%; max-width: 320px; margin: 0 auto; }
  .aigw-outlook-legend { display: flex; justify-content: space-between; gap: 8px; font-size: 9px; color: var(--text-3); margin-top: -6px; }
  .aigw-outlook-now { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px; margin-top: 10px; }
  .aigw-outlook-state { padding: 10px 11px; border-radius: 13px; border: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
    background: linear-gradient(160deg, rgba(255,255,255,0.035), rgba(255,255,255,0.006)), var(--bg-raised); min-width: 0; }
  .aigw-outlook-state-k { font-size: 9px; color: var(--text-3); }
  .aigw-outlook-state-v { font-size: 11.5px; font-weight: 900; color: var(--text-1); margin-top: 3px; line-height: 1.6; overflow-wrap: anywhere; }
  .aigw-signal-row { display: grid; grid-template-columns: minmax(0,1fr) 82px; gap: 9px; align-items: center; padding: 9px 0; border-top: 1px solid color-mix(in srgb, var(--line) 66%, transparent); }
  .aigw-signal-row:first-of-type { border-top: none; }
  .aigw-sig-bar { position: relative; height: 6px; border-radius: 99px; direction: ltr; overflow: hidden;
    background: color-mix(in srgb, var(--text-1) 10%, transparent); }
  .aigw-sig-bar i { position: absolute; inset-block: 0; border-radius: 99px; }
  .aigw-missing { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .aigw-class-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }

  /* ══ the animated weather glyphs ══════════════════════════════════════ */
  .aigw-glyph-svg { width: 100%; height: 100%; }
  .aigw-g-sun-rays { transform-origin: 50% 50%; transform-box: view-box; animation: aigw-g-spin 34s linear infinite; }
  .aigw-g-sun-core { animation: aigw-g-pulse 3.4s ease-in-out infinite; }
  .aigw-g-cloud { animation: aigw-g-drift 7.5s ease-in-out infinite; }
  .aigw-g-cloud.d1 { animation-duration: 9.5s; animation-delay: -2.4s; }
  .aigw-g-drop { animation: aigw-g-dropfall 1.5s linear infinite; }
  .aigw-g-drop.d1 { animation-delay: .4s; }
  .aigw-g-drop.d2 { animation-delay: .8s; }
  .aigw-g-bolt { animation: aigw-g-flash 3.2s steps(1, end) infinite; }
  .aigw-g-wind { stroke-dasharray: 30 10; animation: aigw-g-flow 2.8s linear infinite; }
  .aigw-g-wind.d1 { animation-delay: .45s; }
  .aigw-g-wind.d2 { animation-delay: .9s; }
  .aigw-g-flame { transform-origin: 50% 92%; transform-box: fill-box; animation: aigw-g-flamek 2.4s ease-in-out infinite; }
  .aigw-g-wave { animation: aigw-g-wavek 3.2s ease-in-out infinite; }
  .aigw-g-coin { animation: aigw-g-coink 3.4s ease-in-out infinite; }
  .aigw-g-thermo { stroke-dasharray: 12 14; animation: aigw-g-flow 2.6s linear infinite; }
  .aigw-g-rise { animation: aigw-g-risek 3.6s ease-in-out infinite; }
  .aigw-g-rise.d1 { animation-delay: .6s; }
  .aigw-g-rise.d2 { animation-delay: 1.2s; }
  @keyframes aigw-g-spin { to { transform: rotate(360deg); } }
  @keyframes aigw-g-pulse { 0%,100% { transform: scale(.94); opacity: .85; } 50% { transform: scale(1.06); opacity: 1; } }
  @keyframes aigw-g-drift { 0%,100% { transform: translateX(-1.6px); } 50% { transform: translateX(1.6px); } }
  @keyframes aigw-g-dropfall { 0% { transform: translateY(-3px); opacity: 0; } 25% { opacity: 1; } 100% { transform: translateY(7px); opacity: 0; } }
  @keyframes aigw-g-flash { 0%, 62%, 100% { opacity: .25; } 66%, 70% { opacity: 1; } 74% { opacity: .35; } 78% { opacity: 1; } }
  @keyframes aigw-g-flow { to { stroke-dashoffset: -40; } }
  @keyframes aigw-g-flamek { 0%,100% { transform: scaleY(1) translateY(0); } 50% { transform: scaleY(1.07) translateY(-1px); } }
  @keyframes aigw-g-wavek { 0%,100% { transform: translateX(-1.2px); } 50% { transform: translateX(1.2px); } }
  @keyframes aigw-g-coink { 0%,100% { transform: translateY(0); opacity: .9; } 50% { transform: translateY(-1.6px); opacity: 1; } }
  @keyframes aigw-g-risek { 0%,100% { opacity: .45; } 50% { opacity: 1; } }

  /* ══ skeleton ══════════════════════════════════════════════════════════ */
  .aigw-skel { border-radius: 14px; background: linear-gradient(90deg, rgba(127,127,127,.09), rgba(127,127,127,.18), rgba(127,127,127,.09));
    background-size: 200% 100%; animation: aigw-shimmer 1.4s linear infinite; }
  @keyframes aigw-shimmer { to { background-position: -200% 0; } }

  /* ══ light theme ═══════════════════════════════════════════════════════ */
  :root[data-theme='light'] .aigw-gauge,
  :root[data-theme='light'] .aigw-chain-node,
  :root[data-theme='light'] .aigw-flow-node,
  :root[data-theme='light'] .aigw-branch,
  :root[data-theme='light'] .aigw-blip-detail,
  :root[data-theme='light'] .aigw-weather-card,
  :root[data-theme='light'] .aigw-station,
  :root[data-theme='light'] .aigw-climate,
  :root[data-theme='light'] .aigw-node-chip,
  :root[data-theme='light'] .aigw-dom,
  :root[data-theme='light'] .aigw-prov,
  :root[data-theme='light'] .aigw-leader,
  :root[data-theme='light'] .aigw-tape-row,
  :root[data-theme='light'] .aigw-outlook-state,
  :root[data-theme='light'] .aigw-flow-hero { background: #ffffff; border-color: rgba(13,16,32,0.1); }
  :root[data-theme='light'] .aigw-country-card { background: #ffffff; border-color: rgba(13,16,32,0.12); }
  :root[data-theme='light'] .aigw-globe-wrap,
  :root[data-theme='light'] .aigw-radar-scope { background: #0b1020; }
  :root[data-theme='light'] .aigw-globe-hud .aigw-pill { background-color: rgba(11,16,32,.72); color: #fff; }

  /* ══ responsive + motion ═══════════════════════════════════════════════ */
  @media (max-width: 380px) {
    .aigw-stations, .aigw-dom-grid { grid-template-columns: minmax(0, 1fr); }
    .aigw-gauge { grid-template-columns: auto minmax(0, 1fr); }
    .aigw-gauge-side { grid-column: 1 / -1; flex-direction: row; align-items: center; justify-content: space-between; }
    .aigw-country-bar { width: 78px; }
    .aigw-causal-cols { grid-template-columns: minmax(0, 1fr); }
  }
  @media (prefers-reduced-motion: reduce) {
    .aigw-orbit-a, .aigw-orbit-b, .aigw-sweep, .aigw-sweep-slow, .aigw-blip-ping,
    .aigw-chain-arrow.lit::before, .aigw-flow-conn.on::after, .aigw-leaf, .aigw-branch-tree-path,
    .aigw-helix-a, .aigw-helix-b, .aigw-rung, .aigw-dna-helix, .aigw-skel,
    .aigw-g-sun-rays, .aigw-g-sun-core, .aigw-g-cloud, .aigw-g-drop, .aigw-g-bolt,
    .aigw-g-wind, .aigw-g-flame, .aigw-g-wave, .aigw-g-coin, .aigw-g-thermo, .aigw-g-rise { animation: none; }
    .aigw-branch-tree-path { stroke-dashoffset: 0; }
    .aigw-station:hover, .aigw-weather-card:hover, .aigw-gauge:hover, .aigw-ribbon:hover, .aigw-tape-row:hover { transform: none; }
  }
`;

export default WORLD_STYLES;
