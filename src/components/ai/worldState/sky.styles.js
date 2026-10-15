/**
 * THE CLIMATE SKY — styles for WeatherScene + the frosted glass pane.
 * ---------------------------------------------------------------------------
 * REPORTED (2026-10-15): «باکس اقلیم مالی این دور … اگر آفتابیه پشت شیشه
 * خورشید باشه، اگر بارونیه پشت شیشه بارون بیاد — با رنگ‌بندی و تم درست».
 *
 * Colour follows the WEATHER, in both themes: a deep azure sky with a golden
 * sun, a softer blue with white cloud, slate for overcast, steel-blue for rain
 * and indigo for a storm. Every tone is a set of custom properties on the
 * frame that carries `data-sky="<tone>"`, so the scene, the glass, the border
 * glow and the condition pill all read the same palette.
 *
 * Motion: transform/opacity only; the whole scene stands still under
 * prefers-reduced-motion (see the end of WORLD_STYLES and GLOBAL_PAGE_STYLES).
 * The pane carries the console's single backdrop-filter.
 */
export const SKY_STYLES = `
  /* ══ the climate sky: palettes per tone ════════════════════════════════ */
  [data-sky] {
    --sx: 80%;
    --sky: linear-gradient(165deg, #10141f 0%, #1a2030 100%);
    --sky-acc: #94a3b8;
    --cloud-a: #f8fafc; --cloud-b: #b9c6d8; --cloud-edge: rgba(255,255,255,.34); --cloud-lit: rgba(255,255,255,.85);
  }
  .gw-root[dir='rtl'] [data-sky] { --sx: 20%; }
  [data-sky='sun'] {
    --sky-acc: #fbbf24;
    --sky: radial-gradient(120% 95% at var(--sx) 0%, rgba(255,196,64,.55), rgba(255,160,40,.12) 42%, transparent 66%),
      linear-gradient(165deg, #0b2a6f 0%, #1652c4 54%, #3b82f6 100%);
  }
  [data-sky='partly'] {
    --sky-acc: #7dd3fc;
    --sky: radial-gradient(110% 90% at var(--sx) 0%, rgba(255,214,102,.36), transparent 60%),
      linear-gradient(165deg, #0d2552 0%, #1d4f9e 56%, #4a86cf 100%);
    --cloud-a: #ffffff; --cloud-b: #d3deeb;
  }
  [data-sky='cloud'] {
    --sky-acc: #cbd5e1;
    --sky: radial-gradient(120% 90% at var(--sx) 0%, rgba(203,213,225,.2), transparent 62%),
      linear-gradient(165deg, #1a2231 0%, #2a384e 56%, #43546e 100%);
    --cloud-a: #eef2f7; --cloud-b: #9fb0c6;
  }
  [data-sky='rain'] {
    --sky-acc: #60a5fa;
    --sky: radial-gradient(120% 90% at var(--sx) 0%, rgba(96,165,250,.22), transparent 60%),
      linear-gradient(170deg, #0a1120 0%, #142339 55%, #1f3554 100%);
    --cloud-a: #a9b6ca; --cloud-b: #4b5a72; --cloud-edge: rgba(255,255,255,.16); --cloud-lit: rgba(226,236,250,.5);
  }
  [data-sky='storm'] {
    --sky-acc: #c084fc;
    --sky: radial-gradient(120% 90% at var(--sx) 0%, rgba(167,139,250,.26), transparent 62%),
      linear-gradient(170deg, #07040f 0%, #170e2e 50%, #2a1850 100%);
    --cloud-a: #6d6890; --cloud-b: #26214a; --cloud-edge: rgba(196,181,253,.28); --cloud-lit: rgba(221,214,254,.42);
  }
  [data-sky='windy'] {
    --sky-acc: #5eead4;
    --sky: linear-gradient(165deg, #062a33 0%, #0e4a5a 55%, #167a8c 100%);
  }
  :root[data-theme='light'] [data-sky='sun'] {
    --sky: radial-gradient(120% 95% at var(--sx) 0%, rgba(255,214,90,.8), rgba(255,190,70,.22) 42%, transparent 68%),
      linear-gradient(170deg, #4f9df5 0%, #8cc6ff 55%, #d8ecff 100%);
  }
  :root[data-theme='light'] [data-sky='partly'] {
    --sky: radial-gradient(110% 90% at var(--sx) 0%, rgba(255,226,140,.62), transparent 60%),
      linear-gradient(170deg, #6aa8ea 0%, #a9d0f7 55%, #e6f2fe 100%);
  }
  :root[data-theme='light'] [data-sky='cloud'] {
    --sky: linear-gradient(170deg, #94a3b8 0%, #c3cedc 55%, #e6ebf2 100%);
    --cloud-a: #ffffff; --cloud-b: #cfd8e4;
  }
  :root[data-theme='light'] [data-sky='rain'] {
    --sky: linear-gradient(170deg, #4f6584 0%, #7d93b0 55%, #b5c3d6 100%);
    --cloud-a: #e2e8f0; --cloud-b: #8a9ab0; --cloud-lit: rgba(255,255,255,.6);
  }
  :root[data-theme='light'] [data-sky='storm'] {
    --sky: linear-gradient(170deg, #2f2748 0%, #4f456f 55%, #7f75a0 100%);
    --cloud-a: #a29cbd; --cloud-b: #4c4570;
  }
  :root[data-theme='light'] [data-sky='na'] { --sky: linear-gradient(170deg, #cdd5e1 0%, #e9edf3 100%); }
  :root[data-theme='light'] [data-sky='windy'] { --sky: linear-gradient(170deg, #5cc6d6 0%, #a6e4ec 100%); }

  /* ══ the scene ═════════════════════════════════════════════════════════ */
  .gw-sky { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; border-radius: inherit; background: var(--sky); }
  .gw-sky > span { position: absolute; display: block; }
  .gw-sky svg { display: block; overflow: visible; }
  .gw-sky-glow { inset: -30%; background: radial-gradient(38% 42% at var(--sx) 20%, color-mix(in srgb, var(--sky-acc) 30%, transparent), transparent 72%);
    animation: gw-sky-breathe 7s ease-in-out infinite; }
  .gw-sky-sun { top: -6%; inset-inline-end: 11%; width: 48%; max-width: 178px; aspect-ratio: 1; }
  .gw-sky-sun.small { top: 1%; inset-inline-end: 17%; width: 31%; max-width: 110px; }
  .gw-sky-rays { transform-box: view-box; transform-origin: 50% 50%; animation: gw-sky-spin 46s linear infinite; }
  .gw-sky-halo { transform-box: fill-box; transform-origin: center; animation: gw-sky-halo 5.5s ease-in-out infinite; }
  .gw-sky-flare { border-radius: 50%; background: radial-gradient(circle, rgba(255,242,204,.55), rgba(255,222,150,0) 70%); animation: gw-sky-twinkle 6s ease-in-out infinite; }
  .gw-sky-flare.f1 { width: 28px; height: 28px; top: 44%; inset-inline-end: 43%; }
  .gw-sky-flare.f2 { width: 14px; height: 14px; top: 60%; inset-inline-end: 55%; animation-delay: -2s; }
  .gw-sky-flare.f3 { width: 44px; height: 44px; top: 70%; inset-inline-end: 68%; animation-delay: -4s; }
  .gw-sky-cloud { aspect-ratio: 34 / 26; filter: drop-shadow(0 8px 12px rgba(2,6,23,.28)); animation: gw-sky-drift 12s ease-in-out infinite; }
  .gw-sky-cloud.c1 { top: 15%; inset-inline-end: 5%; width: 44%; max-width: 176px; }
  .gw-sky-cloud.c2 { top: -6%; inset-inline-end: 27%; width: 50%; max-width: 200px; opacity: .78; animation-duration: 17s; animation-delay: -6s; }
  .gw-sky-cloud.c3 { top: 50%; inset-inline-end: -5%; width: 27%; max-width: 110px; opacity: .88; animation-duration: 14s; animation-delay: -9s; }
  .sky-rain .gw-sky-cloud.c1, .sky-storm .gw-sky-cloud.c1 { top: 3%; inset-inline-end: 4%; width: 46%; }
  .sky-rain .gw-sky-cloud.c2, .sky-storm .gw-sky-cloud.c2 { top: -12%; inset-inline-end: 30%; width: 54%; }
  .gw-sky-rain { inset: -25% -15% -10%; transform: rotate(12deg); }
  .gw-root[dir='rtl'] .gw-sky-rain { transform: rotate(-12deg); }
  .gw-sky-rain i { position: absolute; top: 0; left: var(--x); width: 2px; height: var(--h); border-radius: 2px;
    background: linear-gradient(180deg, rgba(196,226,255,0), rgba(214,236,255,.95));
    opacity: 0; animation: gw-sky-fall var(--t) linear var(--d) infinite; }
  .sky-storm .gw-sky-rain i { width: 2.2px; background: linear-gradient(180deg, rgba(221,214,254,0), rgba(237,233,254,.96)); }
  .gw-sky-flash { inset: 0; opacity: 0; background: radial-gradient(90% 80% at var(--sx) 18%, rgba(233,213,255,.8), rgba(196,181,253,.24) 45%, transparent 75%);
    animation: gw-sky-flash 6.5s linear infinite; }
  .gw-sky-bolt { top: 30%; inset-inline-end: 21%; width: 12%; max-width: 46px; aspect-ratio: 1 / 2; opacity: 0;
    filter: drop-shadow(0 0 8px rgba(253,224,71,.85)); animation: gw-sky-flash 6.5s linear infinite; }
  .gw-sky-wind { top: 16%; inset-inline-end: 4%; width: 54%; aspect-ratio: 2; }
  .gw-sky-wind path { animation: gw-sky-gust 4.6s ease-in-out infinite; }
  .gw-sky-wind .w2 { animation-delay: -1.5s; }
  .gw-sky-wind .w3 { animation-delay: -3s; }
  .gw-sky-na { top: 50%; inset-inline-end: 7%; width: 34%; max-width: 132px; aspect-ratio: 1; transform: translateY(-50%); }
  .gw-sky-na-ring { transform-box: fill-box; transform-origin: center; animation: gw-sky-spin 32s linear infinite; }
  .gw-sky-na-pulse { transform-box: fill-box; transform-origin: center; animation: gw-sky-ping 3.6s ease-out infinite; }
  :root[data-theme='light'] .gw-sky-na circle { stroke: rgba(71,85,105,.55); }

  @keyframes gw-sky-breathe { 0%, 100% { opacity: .65; transform: scale(1); } 50% { opacity: 1; transform: scale(1.06); } }
  @keyframes gw-sky-spin { to { transform: rotate(360deg); } }
  @keyframes gw-sky-halo { 0%, 100% { transform: scale(.92); opacity: .78; } 50% { transform: scale(1.06); opacity: 1; } }
  @keyframes gw-sky-twinkle { 0%, 100% { opacity: .35; transform: scale(.9); } 50% { opacity: .9; transform: scale(1.12); } }
  @keyframes gw-sky-drift { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-12px); } }
  @keyframes gw-sky-fall { 0% { transform: translateY(-24px); opacity: 0; } 12% { opacity: .9; } 88% { opacity: .9; } 100% { transform: translateY(330px); opacity: 0; } }
  @keyframes gw-sky-flash { 0%, 63%, 100% { opacity: 0; } 64% { opacity: 1; } 66% { opacity: .18; } 68% { opacity: .95; } 74% { opacity: 0; } }
  @keyframes gw-sky-gust { 0% { transform: translateX(14px); opacity: 0; } 30%, 70% { opacity: 1; } 100% { transform: translateX(-18px); opacity: 0; } }
  @keyframes gw-sky-ping { 0% { transform: scale(.6); opacity: .8; } 100% { transform: scale(1.7); opacity: 0; } }

  /* ══ the frosted pane in front of the sky ══════════════════════════════ */
  .gw-glass {
    position: relative; z-index: 1; isolation: isolate; border-radius: 18px;
    background: linear-gradient(135deg, rgba(255,255,255,.17), rgba(255,255,255,.05) 52%, rgba(255,255,255,.09));
    border: 1px solid rgba(255,255,255,.24);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.38), inset 0 -1px 0 rgba(255,255,255,.06), 0 18px 40px -24px rgba(0,0,0,.75);
    -webkit-backdrop-filter: blur(14px) saturate(1.5);
    backdrop-filter: blur(14px) saturate(1.5);
  }
  .gw-glass::before { content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit; pointer-events: none;
    background: linear-gradient(118deg, rgba(255,255,255,.2), rgba(255,255,255,0) 36%, rgba(255,255,255,0) 70%, rgba(255,255,255,.08)); }
  :root[data-theme='light'] .gw-glass {
    background: linear-gradient(135deg, rgba(255,255,255,.74), rgba(255,255,255,.5));
    border-color: rgba(255,255,255,.88); box-shadow: inset 0 1px 0 #fff, 0 18px 36px -24px rgba(13,16,32,.45);
  }
  .gw-glass-drops { position: absolute; inset: 0; z-index: -1; overflow: hidden; border-radius: inherit; pointer-events: none; }
  .gw-glass-drops i { position: absolute; left: var(--x); top: var(--y); width: var(--s); height: calc(var(--s) * 1.18);
    border-radius: 50% 50% 46% 46% / 56% 56% 44% 44%;
    background: radial-gradient(circle at 34% 30%, rgba(255,255,255,.92) 0 16%, rgba(255,255,255,.24) 38%, rgba(255,255,255,.08) 72%);
    box-shadow: 0 1px 1.5px rgba(0,0,0,.3), inset 0 -1px 1.5px rgba(255,255,255,.42); }
  .gw-glass-drops i.run { opacity: 0; animation: gw-glass-run var(--t) cubic-bezier(.5,0,.9,.6) var(--d) infinite; }
  .gw-glass-drops i.bead { animation: gw-glass-bead 6s ease-in-out infinite; }
  :root[data-theme='light'] .gw-glass-drops i { box-shadow: 0 1px 1.5px rgba(13,16,32,.25), inset 0 -1px 1.5px rgba(255,255,255,.7);
    background: radial-gradient(circle at 34% 30%, #fff 0 16%, rgba(120,150,190,.28) 40%, rgba(120,150,190,.12) 72%); }
  @keyframes gw-glass-run { 0%, 50% { transform: translateY(0) scaleY(1); opacity: 0; } 56% { opacity: .95; } 90% { transform: translateY(42px) scaleY(1.25); opacity: .85; } 100% { transform: translateY(54px) scaleY(1.3); opacity: 0; } }
  @keyframes gw-glass-bead { 0%, 100% { opacity: .55; } 50% { opacity: .92; } }

  /* ══ the world tab: the climate card opens with the same weather window ═ */
  .aigw-climate-window {
    position: relative; overflow: hidden; isolation: isolate; display: flex; align-items: flex-end;
    min-height: 184px; padding: 12px; border-radius: 18px; color: var(--text-1);
    border: 1px solid color-mix(in srgb, var(--sky-acc) 42%, transparent);
    box-shadow: 0 22px 44px -32px color-mix(in srgb, var(--sky-acc) 90%, transparent);
    --text-1: #ffffff; --text-2: rgba(240,246,255,.86); --text-3: rgba(226,236,250,.72);
  }
  :root[data-theme='light'] .aigw-climate-window { --text-1: #0d1020; --text-2: #2c3650; --text-3: #46506b; }
  .aigw-climate-window > .aigw-climate-main { width: min(74%, 440px); padding: 12px 14px; gap: 12px; }
  .aigw-climate-window .aigw-climate-label { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .aigw-climate-window .aigw-climate-index b { font-size: 34px; line-height: 1; text-shadow: 0 6px 22px color-mix(in srgb, var(--sky-acc) 60%, transparent); }
  .aigw-sky-pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 900;
    color: var(--text-1); background: color-mix(in srgb, var(--sky-acc) 30%, rgba(255,255,255,.06));
    border: 1px solid color-mix(in srgb, var(--sky-acc) 60%, transparent); }
  .aigw-sky-pill::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--sky-acc); box-shadow: 0 0 10px var(--sky-acc); }
  @media (max-width: 380px) { .aigw-climate-window > .aigw-climate-main { width: 86%; } }
  /* on a wide screen the window is a panorama: anchor the sky's focal objects
     to the pane's edge (not to the far end), so the sun still sits behind
     the glass and the clouds gather beside it */
  @media (min-width: 900px) {
    .aigw-climate-window { --gw: 440px; min-height: 196px; }
    .gw-root[dir='rtl'] .aigw-climate-window { --sx: calc(100% - var(--gw) - 40px); }
    .gw-root[dir='ltr'] .aigw-climate-window { --sx: calc(var(--gw) + 40px); }
    .aigw-climate-window .gw-sky > span:not(.gw-sky-glow):not(.gw-sky-rain):not(.gw-sky-flash) { inset-inline-end: auto; }
    .aigw-climate-window .gw-sky-sun { inset-inline-start: calc(var(--gw) - 50px); width: 186px; top: -14%; }
    .aigw-climate-window .gw-sky-sun.small { inset-inline-start: calc(var(--gw) + 40px); width: 112px; top: 2%; }
    .aigw-climate-window .gw-sky-cloud.c1 { inset-inline-start: calc(var(--gw) - 30px); width: 210px; }
    .aigw-climate-window .gw-sky-cloud.c2 { inset-inline-start: calc(var(--gw) + 150px); width: 240px; }
    .aigw-climate-window .gw-sky-cloud.c3 { inset-inline-start: calc(var(--gw) + 360px); width: 130px; top: 40%; }
    .aigw-climate-window .gw-sky-bolt { inset-inline-start: calc(var(--gw) + 100px); width: 44px; }
    .aigw-climate-window .gw-sky-wind { inset-inline-start: calc(var(--gw) + 40px); width: 300px; }
    .aigw-climate-window .gw-sky-na { inset-inline-start: calc(var(--gw) + 60px); }
    .aigw-climate-window .gw-sky-flare.f1 { inset-inline-start: calc(var(--gw) + 170px); top: 58%; }
    .aigw-climate-window .gw-sky-flare.f2 { inset-inline-start: calc(var(--gw) + 250px); top: 72%; }
    .aigw-climate-window .gw-sky-flare.f3 { inset-inline-start: calc(var(--gw) + 340px); top: 50%; }
  }
`;

export default SKY_STYLES;
