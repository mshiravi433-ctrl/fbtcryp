/**
 * FBT WORLD CONSOLE — the 2026-10-15 modernisation layer.
 * ---------------------------------------------------------------------------
 * REPORTED (2026-10-15):
 *   · «وضعیت جهانی آیکون‌ها مدرن و درست رنگی بشه»;
 *   · «چشم‌انداز اقتصادی — خوانش ترکیبی: اون حالت عقربه را کلا مدرن‌ترش کن»;
 *   · «درخت آینده را خیلی مدرن کن با رنگ‌بندی جذاب».
 *
 * Included in WORLD_STYLES (after the base sheet, before the theme and motion
 * sections), so the light theme and prefers-reduced-motion still have the last
 * word. Every keyframe here animates transform/opacity only.
 */
export const MODERN_STYLES = `
  /* ══ colour glyphs: refinements ═══════════════════════════════════════ */
  .aigw-g-sun-core, .aigw-g-coin { transform-box: fill-box; transform-origin: center; }
  .aigw-g-halo { transform-box: fill-box; transform-origin: center; animation: aigw-g-halok 4.6s ease-in-out infinite; }
  .aigw-g-thermo { stroke-dasharray: none; transform-box: fill-box; transform-origin: 50% 100%; animation: aigw-g-thermok 3.8s ease-in-out infinite; }
  .aigw-g-glint { animation: aigw-g-glintk 4.8s ease-in-out infinite; }
  @keyframes aigw-g-halok { 0%, 100% { opacity: .7; transform: scale(.94); } 50% { opacity: 1; transform: scale(1.04); } }
  @keyframes aigw-g-thermok { 0%, 100% { transform: scaleY(.84); } 50% { transform: scaleY(1); } }
  @keyframes aigw-g-glintk { 0%, 58% { transform: translateX(0); opacity: 0; } 64% { opacity: 1; } 100% { transform: translateX(44px); opacity: 0; } }
  .aigw-station .aigw-glyph { filter: drop-shadow(0 6px 12px rgba(2,6,23,.22)); }
  :root[data-theme='light'] .aigw-station .aigw-glyph { filter: drop-shadow(0 6px 10px rgba(13,16,32,.12)); }

  /* ══ the nine gauges: every measure in its own colours ════════════════ */
  .aigw-gauge.tinted .aigw-gauge-icon {
    color: var(--g1);
    background: linear-gradient(140deg, color-mix(in srgb, var(--g1) 24%, transparent), color-mix(in srgb, var(--g2) 9%, transparent));
    border: 1px solid color-mix(in srgb, var(--g1) 34%, transparent);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 10px 20px -14px var(--g1);
  }
  .aigw-gauge.tinted:hover { border-color: color-mix(in srgb, var(--g1) 40%, var(--line)); }
  .aigw-gauge.tinted .aigw-gauge-meter i.on:not(.bad) { background: linear-gradient(90deg, var(--g1), var(--g2)); box-shadow: 0 0 8px -2px var(--g1); }
  .aigw-sec > .aigw-icon { color: var(--acc1); }

  /* ══ the outlook dial («چشم‌انداز اقتصادی — خوانش ترکیبی») ══════════════ */
  .aigw-outlook-gauge {
    position: relative; margin-top: 10px; padding: 14px 12px 15px; border-radius: 22px; overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--ol-tone) 28%, var(--line));
    background:
      radial-gradient(85% 75% at 50% 92%, color-mix(in srgb, var(--ol-tone) 18%, transparent), transparent 70%),
      linear-gradient(165deg, rgba(255,255,255,.055), rgba(255,255,255,.01)), var(--bg-raised);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 24px 48px -36px color-mix(in srgb, var(--ol-tone) 85%, transparent);
  }
  .aigw-outlook-gauge .aigw-outlook-arc { max-width: 350px; overflow: visible; }
  .aigw-ol-guide { fill: none; stroke: color-mix(in srgb, var(--text-1) 14%, transparent); stroke-width: 1; stroke-dasharray: 2 4; }
  .aigw-ol-seg { fill: none; opacity: .17; }
  .aigw-ol-seg.lit { opacity: 1; animation: gw-ol-seg .5s cubic-bezier(.3,.7,.2,1) both; animation-delay: calc(var(--i, 0) * 45ms + 250ms); }
  .aigw-ol-tick { stroke: color-mix(in srgb, var(--text-1) 26%, transparent); stroke-width: 1; stroke-linecap: round; }
  .aigw-ol-tick.major { stroke: color-mix(in srgb, var(--text-1) 62%, transparent); stroke-width: 1.6; }
  .aigw-ol-num { font-family: inherit; font-size: 9.5px; font-weight: 800; fill: var(--text-3); }
  .aigw-ol-zone { font-family: inherit; font-size: 10px; font-weight: 900; }
  .aigw-ol-zone.down { fill: #f87171; }
  .aigw-ol-zone.up { fill: #4ade80; }
  :root[data-theme='light'] .aigw-ol-zone.down { fill: #dc2626; }
  :root[data-theme='light'] .aigw-ol-zone.up { fill: #16a34a; }
  .aigw-ol-needle { transform-box: view-box; transform-origin: 160px 160px; transform: rotate(var(--deg));
    animation: gw-ol-needle 1.5s cubic-bezier(.22,1.2,.36,1) both; }
  .aigw-ol-core { transform-box: fill-box; transform-origin: center; animation: gw-ol-core 2.8s ease-in-out infinite; }
  .aigw-outlook-gauge .aigw-outlook-legend { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; margin-top: 0; text-align: center; }
  .aigw-ol-score { font-size: 30px; font-weight: 950; line-height: 1.1; letter-spacing: -.5px; color: var(--ol-tone); font-variant-numeric: tabular-nums;
    text-shadow: 0 6px 24px color-mix(in srgb, var(--ol-tone) 45%, transparent); animation: gw-ol-rise .6s .5s cubic-bezier(.3,.7,.2,1) both; }
  .aigw-ol-score.na { font-size: 15px; color: var(--text-3); text-shadow: none; }
  .aigw-ol-verdict { display: inline-flex; align-items: center; gap: 6px; padding: 3px 12px; border-radius: 999px; font-size: 11px; font-weight: 900; color: var(--text-1);
    background: color-mix(in srgb, var(--ol-tone) 16%, transparent); border: 1px solid color-mix(in srgb, var(--ol-tone) 45%, transparent); }
  .aigw-ol-verdict::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--ol-tone); box-shadow: 0 0 10px var(--ol-tone); }
  .aigw-ol-cap { font-size: 9.5px; font-weight: 750; color: var(--text-3); }
  :root[data-theme='light'] .aigw-outlook-gauge {
    background: radial-gradient(85% 75% at 50% 92%, color-mix(in srgb, var(--ol-tone) 14%, transparent), transparent 70%), #ffffff;
    border-color: color-mix(in srgb, var(--ol-tone) 30%, rgba(13,16,32,.1));
  }
  :root[data-theme='light'] .aigw-ol-seg:not(.lit) { opacity: .24; }
  @keyframes gw-ol-seg { from { opacity: .17; } to { opacity: 1; } }
  @keyframes gw-ol-needle { from { transform: rotate(-90deg); } }
  @keyframes gw-ol-core { 0%, 100% { opacity: .85; transform: scale(.92); } 50% { opacity: 1; transform: scale(1.06); } }
  @keyframes gw-ol-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

  /* ══ the future tree («درخت آینده») ═══════════════════════════════════ */
  .aigw-tree-stage {
    margin: 4px 0 12px; padding: 8px 6px 2px; border-radius: 24px; overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--acc1) 20%, var(--line));
    background:
      radial-gradient(70% 55% at 50% 30%, rgba(163,230,53,.12), transparent 70%),
      radial-gradient(60% 40% at 50% 100%, rgba(45,212,191,.16), transparent 72%),
      linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.008)), var(--bg-raised);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 26px 50px -40px rgba(163,230,53,.6);
  }
  :root[data-theme='light'] .aigw-tree-stage {
    background: radial-gradient(70% 55% at 50% 30%, rgba(163,230,53,.16), transparent 70%),
      radial-gradient(60% 40% at 50% 100%, rgba(45,212,191,.18), transparent 72%), #ffffff;
    border-color: rgba(13,16,32,.1); box-shadow: 0 22px 44px -36px rgba(13,16,32,.35);
  }
  .aigw-tree-stage .aigw-tree-svg { max-width: 360px; overflow: visible; }
  .aigw-tree-ground { fill: rgba(45,212,191,.24); }
  .aigw-tree-aura { transform-box: fill-box; transform-origin: center; opacity: .7; }
  .aigw-canopy.lead .aigw-tree-aura { opacity: 1; animation: gw-tree-aura 3.6s ease-in-out infinite; }
  .aigw-firefly { opacity: 0; animation: gw-tree-firefly 4.2s ease-in-out infinite; }
  .aigw-tree-badge rect { fill: color-mix(in srgb, var(--case) 20%, rgba(6,10,24,.74)); stroke: color-mix(in srgb, var(--case) 62%, transparent); stroke-width: 1; }
  .aigw-tree-badge.lead rect { fill: color-mix(in srgb, var(--case) 46%, rgba(6,10,24,.55)); stroke: var(--case); stroke-width: 1.6; }
  .aigw-tree-badge-v { font-family: inherit; font-size: 13px; font-weight: 950; fill: #ffffff; }
  .aigw-tree-badge-k { font-family: inherit; font-size: 8.5px; font-weight: 800; fill: rgba(255,255,255,.8); }
  :root[data-theme='light'] .aigw-tree-badge rect { fill: color-mix(in srgb, var(--case) 14%, #ffffff); }
  :root[data-theme='light'] .aigw-tree-badge.lead rect { fill: color-mix(in srgb, var(--case) 26%, #ffffff); }
  :root[data-theme='light'] .aigw-tree-badge-v { fill: #0d1020; }
  :root[data-theme='light'] .aigw-tree-badge-k { fill: #46506b; }
  @keyframes gw-tree-aura { 0%, 100% { transform: scale(.94); opacity: .75; } 50% { transform: scale(1.06); opacity: 1; } }
  @keyframes gw-tree-firefly { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: 1; } 80% { opacity: .75; } 100% { transform: translateY(-26px); opacity: 0; } }
  @keyframes gw-tree-bar { from { transform: scaleX(0); } to { transform: scaleX(1); } }

  .aigw-tree-root { gap: 11px; padding: 11px 13px; border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--acc1) 24%, var(--line));
    background: linear-gradient(135deg, color-mix(in srgb, var(--acc1) 10%, transparent), rgba(255,255,255,.01) 60%), var(--bg-raised); }
  .aigw-tree-root-ico { display: inline-grid; place-items: center; flex: 0 0 auto; width: 38px; height: 38px; border-radius: 13px;
    background: linear-gradient(140deg, color-mix(in srgb, var(--g1) 26%, transparent), color-mix(in srgb, var(--g2) 10%, transparent));
    border: 1px solid color-mix(in srgb, var(--g1) 38%, transparent); box-shadow: 0 10px 22px -14px var(--g1); }

  .aigw-branch {
    padding: 12px 14px 13px 16px; border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--branch-tone) 24%, var(--line));
    background:
      linear-gradient(200deg, color-mix(in srgb, var(--branch-tone) 12%, transparent), transparent 58%),
      linear-gradient(160deg, rgba(255,255,255,.045), rgba(255,255,255,.008)), var(--bg-raised);
    box-shadow: 0 18px 36px -32px color-mix(in srgb, var(--branch-tone) 80%, transparent);
  }
  :root[data-theme='light'] .aigw-panel .aigw-branch {
    background: linear-gradient(200deg, color-mix(in srgb, var(--branch-tone) 9%, #ffffff), #ffffff 58%);
    border-color: color-mix(in srgb, var(--branch-tone) 28%, rgba(13,16,32,.1));
  }
  .aigw-branch::before { width: 4px; inset-block: 10px;
    background: linear-gradient(180deg, color-mix(in srgb, var(--branch-tone) 55%, #ffffff), var(--branch-tone)); box-shadow: 0 0 14px var(--branch-tone); }
  .aigw-branch.lead { border-color: color-mix(in srgb, var(--branch-tone) 50%, var(--line)); box-shadow: 0 22px 44px -28px color-mix(in srgb, var(--branch-tone) 95%, transparent); }
  .aigw-branch-name { flex-wrap: wrap; }
  .aigw-branch-ico { display: inline-grid; place-items: center; flex: 0 0 auto; width: 28px; height: 28px; border-radius: 10px;
    background: linear-gradient(140deg, color-mix(in srgb, var(--branch-tone) 26%, transparent), color-mix(in srgb, var(--branch-tone) 8%, transparent));
    border: 1px solid color-mix(in srgb, var(--branch-tone) 36%, transparent); }
  .aigw-branch-lead { font-size: 9px; font-weight: 850; padding: 2px 8px; border-radius: 999px; color: var(--branch-tone);
    background: color-mix(in srgb, var(--branch-tone) 13%, transparent); border: 1px solid color-mix(in srgb, var(--branch-tone) 35%, transparent); }
  .aigw-branch-weight { font-size: 20px; text-shadow: 0 4px 18px color-mix(in srgb, var(--branch-tone) 45%, transparent); }
  .aigw-branch-bar { height: 8px; }
  .aigw-branch-bar i { background: linear-gradient(90deg, color-mix(in srgb, var(--branch-tone) 45%, transparent), var(--branch-tone));
    box-shadow: 0 0 12px -2px var(--branch-tone); transform-origin: left center; animation: gw-tree-bar .9s cubic-bezier(.3,.7,.2,1) both; }

  /* ══ the lion beside Iran ══════════════════════════════════════════════ */
  .aigw-lion { flex: 0 0 auto; display: inline-block; vertical-align: middle; filter: drop-shadow(0 2px 4px rgba(180,83,9,.35)); }
  .aigw-lion-medal { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; flex: 0 0 auto;
    background: radial-gradient(circle at 50% 40%, rgba(251,191,36,.28), rgba(251,191,36,.06) 70%);
    border: 1px solid rgba(251,191,36,.45); box-shadow: 0 8px 20px -10px rgba(245,158,11,.8); }
  .aigw-lion-medal .aigw-lion { filter: drop-shadow(0 3px 6px rgba(180,83,9,.45)); }
`;

export default MODERN_STYLES;
