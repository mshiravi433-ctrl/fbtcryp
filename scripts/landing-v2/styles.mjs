/**
 * LANDING 2.0 — DESIGN SYSTEM (hand-rolled, zero dependencies).
 * ---------------------------------------------------------------------------
 * Mobile-first, dark-futuristic, glassmorphism. Every layout rule uses CSS
 * logical properties so the SAME stylesheet renders both LTR and RTL — the
 * only thing that flips is 'dir' on <html>.
 *
 * Second-language switching is pure CSS: each bilingual string is rendered
 * twice ('span.lg-en'/'span.lg-fa') at build time and the root's data-lang
 * decides which one is visible. No reflow of hidden DOM, no JS string
 * surgery on every toggle, and no-JS visitors still get the English default.
 */

export const CSS = /* css */ `
/* ─────────────────────────── tokens ─────────────────────────── */
:root {
  color-scheme: dark;
  --bg: #05030e;
  --bg-2: #0a0718;
  --ink: #eef1ff;
  --muted: #aab2d0;
  --quiet: #78829f;
  --line: rgba(160, 175, 230, 0.14);
  --glass: rgba(17, 14, 40, 0.55);
  --glass-2: rgba(23, 19, 52, 0.72);
  --violet: #8b5cf6;
  --violet-2: #7c3aed;
  --cyan: #4eeaff;
  --pink: #ff68ca;
  --lime: #63f5bb;
  --amber: #ffc45d;
  --red: #ff6b8b;
  --radius: 20px;
  --radius-lg: 28px;
  --font-en: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  --font-fa: "Vazirmatn", var(--font-en);
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --shadow-lg: 0 24px 70px -18px rgba(0, 0, 0, 0.65);
  --glow-violet: 0 0 42px -6px rgba(139, 92, 246, 0.55);
}

* { box-sizing: border-box; }
html { min-height: 100%; background: var(--bg); scroll-behavior: smooth; }
body {
  margin: 0;
  min-height: 100svh;
  overflow-x: hidden;
  background:
    radial-gradient(1100px 640px at 78% -12%, rgba(124, 58, 237, 0.28), transparent 60%),
    radial-gradient(900px 620px at -12% 22%, rgba(78, 234, 255, 0.1), transparent 58%),
    radial-gradient(760px 520px at 108% 58%, rgba(255, 104, 202, 0.09), transparent 60%),
    var(--bg);
  color: var(--ink);
  font-family: var(--font-en);
  font-size: 16px;
  line-height: 1.72;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
html[lang="fa"] body { font-family: var(--font-fa); }
a { color: inherit; }
img { max-width: 100%; }
.ic-defs { position: absolute; width: 0; height: 0; overflow: hidden; }
.ic { width: 20px; height: 20px; flex: 0 0 auto; overflow: visible; }
.ic-flip { transform: scaleX(-1); }
html[dir="rtl"] .ic-flip { transform: none; }
.ic-inline { width: 16px; height: 16px; }
.ic-in-btn { width: 18px; height: 18px; }
/* The plate keeps a dark tinted box the same aspect ratio as the art, so a
   slide is never shorter before its JPEG decodes — the Ken Burns loop starts
   as soon as it is there, and nothing jumps while it is not. */
.slide-art { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: cover; }
.ic-bullet { width: 14px; height: 14px; color: var(--cyan); }
/* Draw-in: every path in a symbol carries pathLength="100" (see index.mjs),
   so one dash animation works for a 6-unit tick and a 20-unit arc alike. */
html[data-js] .card-icon .ic path,
html[data-js] .dock-tile .ic path { stroke-dasharray: 100; stroke-dashoffset: 100; transition: stroke-dashoffset 0.7s ease calc(var(--d, 0ms) + 120ms); }
html[data-js] .reveal.in .card-icon .ic path,
html[data-js] .dock.is-open .dock-tile .ic path { stroke-dashoffset: 0; }
button { font-family: inherit; }
::selection { background: rgba(139, 92, 246, 0.45); }

/* bilingual swap: exactly one of each pair is visible */
[data-lang="en"] .lg-fa { display: none !important; }
[data-lang="fa"] .lg-en { display: none !important; }
.lg-fa { font-family: var(--font-fa); }
[data-lang="fa"] :is(h1, h2, h3, .btn, .nav-links a, .brand, .chip, th) { letter-spacing: 0; }

.skip-link {
  position: fixed;
  z-index: 60;
  inset-block-start: 10px;
  inset-inline-start: 10px;
  transform: translateY(-180%);
  padding: 9px 14px;
  border-radius: 12px;
  color: #031019;
  background: var(--cyan);
  font-weight: 700;
  text-decoration: none;
  transition: transform 0.2s ease;
}
.skip-link:focus-visible { transform: none; }

/* ─────────────────────────── backdrop ─────────────────────────── */
/*
 * The animated line field the request asked for («پس‌زمینه از خطوط انیمیشنی
 * استفاده کند»). It is one fixed layer behind everything, made of:
 *
 *   • a grid that drifts — a transform, so it costs the compositor nothing;
 *   • six long curves whose dash travels along them, which is what makes the
 *     field read as flowing instead of as a static wireframe;
 *   • a soft beam that scans down the viewport once a minute;
 *   • three blurred orbs for colour.
 *
 * Nothing here runs a JavaScript frame loop, and the whole layer is switched
 * off under prefers-reduced-motion.
 */
.ambient { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
.ambient-grid {
  position: absolute; inset: -20% -10%;
  background-image:
    linear-gradient(rgba(139, 92, 246, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(78, 234, 255, 0.055) 1px, transparent 1px);
  background-size: 54px 54px;
  mask-image: radial-gradient(78% 60% at 50% 0%, #000 0%, transparent 92%);
  animation: grid-drift 42s linear infinite;
}
@keyframes grid-drift { from { background-position: 0 0, 0 0; } to { background-position: 54px 108px, 108px 54px; } }
.bg-lines { position: absolute; inset: -6% 0 auto 0; width: 100%; height: min(760px, 92vh); opacity: 0.75; transform: translate3d(0, calc(var(--shift, 0) * -1px), 0); transition: transform 0.35s linear; }
.bg-lines path { fill: none; stroke-dasharray: 12 260; stroke-linecap: round; animation-name: line-travel; animation-timing-function: linear; animation-iteration-count: infinite; }
@keyframes line-travel { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -1400; } }
.beam {
  position: absolute; inset-inline: 0; inset-block-start: -30%; height: 34vh;
  background: linear-gradient(180deg, transparent, rgba(124, 58, 237, 0.1), transparent);
  mask-image: linear-gradient(180deg, transparent, #000 42%, transparent);
  animation: beam-scan 46s ease-in-out infinite;
}
@keyframes beam-scan { 0% { transform: translateY(0); opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } 100% { transform: translateY(360vh); opacity: 0; } }
.orb { position: absolute; border-radius: 50%; filter: blur(90px); opacity: 0.5; }
.orb-a { width: 44vw; height: 44vw; max-width: 640px; max-height: 640px; inset-block-start: -16%; inset-inline-end: -10%; background: radial-gradient(circle, rgba(124, 58, 237, 0.5), transparent 62%); animation: orb-drift 26s ease-in-out infinite alternate; }
.orb-b { width: 36vw; height: 36vw; max-width: 520px; max-height: 520px; inset-block-start: 34%; inset-inline-start: -14%; background: radial-gradient(circle, rgba(78, 234, 255, 0.22), transparent 62%); animation: orb-drift 32s ease-in-out infinite alternate-reverse; }
.orb-c { width: 30vw; height: 30vw; max-width: 460px; max-height: 460px; inset-block-start: 120%; inset-inline-end: 4%; background: radial-gradient(circle, rgba(99, 245, 187, 0.16), transparent 64%); animation: orb-drift 38s ease-in-out infinite alternate; }
@keyframes orb-drift { from { transform: translate3d(0, 0, 0) scale(1); } to { transform: translate3d(4vw, 6vh, 0) scale(1.12); } }

/* ─────────────────────────── layout ─────────────────────────── */
/*
 * The measure this page opens at. 1180px in a 1920px viewport left the hero
 * dashboard and the tour crushed into the middle third of the screen; 1320px
 * with 24px side gutters on wide screens uses the space without letting a line
 * of body copy run past a readable measure (the prose blocks cap themselves with
 * their own max-width: 56–78ch rules).
 */
.wrap { width: min(1320px, 100% - 32px); margin-inline: auto; }
@media (max-width: 700px) { .wrap { width: min(1320px, 100% - 24px); } }
section { padding-block: clamp(44px, 7vw, 88px); scroll-margin-top: 88px; }
.panel {
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: linear-gradient(160deg, rgba(23, 18, 52, 0.6), rgba(10, 8, 26, 0.75));
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

/* ─────────────────────────── nav ─────────────────────────── */
.nav {
  position: sticky; inset-block-start: 0; z-index: 40;
  border-block-end: 1px solid transparent;
  transition: background 0.25s ease, border-color 0.25s ease, backdrop-filter 0.25s ease, padding 0.25s ease;
}
.nav.scrolled {
  background: rgba(7, 5, 20, 0.72);
  border-block-end-color: var(--line);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.nav-inner { display: flex; align-items: center; gap: 12px; padding-block: 12px; }

/*
 * Logo only, as asked. The mark is bigger than it used to be (a 26px image in
 * a 46px plate instead of 24 in 34) because it is now the only thing the header
 * says about who we are, and it wears the brand's own gradient ring so it reads
 * as a logo and not as a favicon that escaped into a header.
 */
.brand { display: inline-flex; align-items: center; text-decoration: none; }
.brand-mark {
  position: relative; display: grid; place-items: center; width: 46px; height: 46px; border-radius: 15px;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.4), rgba(78, 234, 255, 0.22));
  border: 1px solid rgba(139, 92, 246, 0.45);
  box-shadow: var(--glow-violet), inset 0 1px 0 rgba(255, 255, 255, 0.2);
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}
.brand-mark img { border-radius: 10px; position: relative; z-index: 1; }
.brand-mark .brand-ring {
  position: absolute; inset: -3px; border-radius: 18px; pointer-events: none;
  background: conic-gradient(from 0deg, rgba(139, 92, 246, 0), rgba(139, 92, 246, 0.85) 22%, rgba(78, 234, 255, 0.9) 42%, rgba(99, 245, 187, 0) 62%, rgba(255, 104, 202, 0.5) 82%, rgba(139, 92, 246, 0) 100%);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude; -webkit-mask-composite: xor; padding: 1.6px;
  animation: ring-turn 7s linear infinite;
}
@keyframes ring-turn { to { transform: rotate(360deg); } }
.brand:hover .brand-mark { transform: translateY(-1px) scale(1.04); box-shadow: 0 0 54px -4px rgba(139, 92, 246, 0.75); }

.nav-links { display: none; align-items: center; gap: 2px; margin-inline-start: 10px; }
.nav-links a {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 11px; border-radius: 11px; color: var(--muted); font-size: 13.5px; font-weight: 650;
  text-decoration: none; position: relative; transition: color 0.2s, background 0.2s;
}
.nav-links a .ic { width: 15px; height: 15px; opacity: 0.75; transition: opacity 0.2s, transform 0.25s; }
.nav-links a:hover { color: var(--ink); background: rgba(139, 92, 246, 0.14); }
.nav-links a:hover .ic { opacity: 1; transform: translateY(-1px); }
.nav-links a.is-active { color: #fff; }
.nav-links a.is-active::after {
  content: ""; position: absolute; inset-inline: 10px; inset-block-end: 3px; height: 2px; border-radius: 2px;
  background: linear-gradient(90deg, var(--violet), var(--cyan));
  animation: bar-in 0.35s ease;
}
@keyframes bar-in { from { transform: scaleX(0); opacity: 0; } to { transform: none; opacity: 1; } }
.nav-spacer { flex: 1; }
.lang-switch {
  display: inline-flex; align-items: center; gap: 2px; padding: 3px;
  border: 1px solid var(--line); border-radius: 12px; background: rgba(12, 9, 30, 0.6);
}
.lang-btn {
  border: 0; border-radius: 9px; padding: 6px 11px; cursor: pointer;
  background: transparent; color: var(--muted); font-size: 12.5px; font-weight: 700;
  transition: background 0.2s, color 0.2s;
}
.lang-btn[aria-pressed="true"] { background: linear-gradient(120deg, var(--violet-2), #5b8cff); color: #fff; box-shadow: 0 6px 18px -6px rgba(124, 58, 237, 0.7); }

/*
 * «اندازه بازکردن برنامه را بهتر کن» — the Launch-App control. It was a 13.5px
 * pill with 10px of padding, hidden entirely below 900px: the one action this
 * page exists to sell was the smallest thing on it, and invisible on the
 * device most of our readers use. It is now a real button at every width, and
 * the label drops out below 420px where the row is tight (the icon and the
 * accessible name stay).
 */
.nav-cta {
  display: inline-flex; align-items: center; gap: 9px; padding: 12px 20px; font-size: 14.5px;
  border-radius: 14px; box-shadow: 0 14px 34px -10px rgba(109, 86, 246, 0.65);
}
.nav-cta .ic { width: 17px; height: 17px; }
@media (max-width: 420px) {
  .nav-cta { padding: 12px 14px; }
  .nav-cta > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
}
@media (min-width: 900px) {
  .nav-links { display: inline-flex; }
}

/* ─────────────────────────── buttons / chips ─────────────────────────── */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  padding: 14px 22px; border-radius: 15px; border: 1px solid transparent;
  font-size: 15px; font-weight: 750; text-decoration: none; cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.25s ease, border-color 0.2s;
}
.btn:active { transform: translateY(1px) scale(0.99); }
.btn-primary {
  color: #fff;
  background: linear-gradient(120deg, var(--violet-2) 0%, #5b8cff 52%, #00c2ff 110%);
  box-shadow: 0 14px 34px -10px rgba(109, 86, 246, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.22);
}
.btn-primary:hover { box-shadow: 0 18px 44px -10px rgba(109, 86, 246, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.22); transform: translateY(-2px); }
.btn-ghost { color: var(--ink); border-color: rgba(160, 175, 230, 0.3); background: rgba(14, 11, 34, 0.5); }
.btn-ghost:hover { border-color: var(--cyan); color: var(--cyan); transform: translateY(-2px); }
.btn .arr { transition: transform 0.2s ease; }
.btn:hover .arr { transform: translateX(3px); }
html[dir="rtl"] .btn .arr { transform: scaleX(-1); }
html[dir="rtl"] .btn:hover .arr { transform: scaleX(-1) translateX(3px); }

.chip {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 13px; border-radius: 999px; border: 1px solid var(--line);
  background: rgba(15, 12, 36, 0.55); color: var(--muted);
  font-size: 12.5px; font-weight: 650; white-space: nowrap;
}
.chip .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 7px; }
.chip-glow { border-color: rgba(139, 92, 246, 0.4); color: #d7c9ff; }

.live-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--lime); flex: 0 0 8px;
  box-shadow: 0 0 0 4px rgba(99, 245, 187, 0.12), 0 0 12px var(--lime);
  animation: pulse-dot 2.2s ease-in-out infinite;
}
@keyframes pulse-dot {
  0%, 100% { box-shadow: 0 0 0 4px rgba(99, 245, 187, 0.12), 0 0 12px var(--lime); }
  50% { box-shadow: 0 0 0 7px rgba(99, 245, 187, 0.04), 0 0 20px var(--lime); }
}

/* ─────────────────────────── hero ─────────────────────────── */
.hero { padding-block-start: clamp(34px, 6vw, 84px); }
.hero-grid { display: grid; gap: clamp(28px, 4vw, 48px); align-items: center; }
@media (min-width: 1000px) { .hero-grid { grid-template-columns: 1.02fr 0.98fr; } }
.eyebrow {
  display: inline-flex; align-items: center; gap: 9px; margin: 0 0 18px;
  padding: 6px 14px; border-radius: 999px; border: 1px solid rgba(139, 92, 246, 0.45);
  background: rgba(124, 58, 237, 0.12); color: #d6c8ff; font-size: 12.5px; font-weight: 700; letter-spacing: 0.02em;
}
h1 {
  margin: 0; font-size: clamp(34px, 7.4vw, 62px); line-height: 1.08; letter-spacing: -0.035em; font-weight: 850;
}
h1 .grad, .grad {
  background: linear-gradient(105deg, #b79cff 0%, var(--violet) 38%, var(--cyan) 78%, var(--lime) 108%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.hero-sub { margin: 20px 0 0; max-width: 56ch; color: var(--muted); font-size: clamp(15.5px, 2.3vw, 18px); }
.hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-block-start: 28px; }
.hero-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-block-start: 24px; list-style: none; padding: 0; }
.hero-chips .chip { background: rgba(15, 12, 36, 0.75); }

/* hero dashboard mockup: environment chrome only; numbers arrive live */
.dash {
  position: relative; padding: 16px;
  border-radius: 26px; border: 1px solid rgba(160, 175, 230, 0.2);
  background: linear-gradient(165deg, rgba(22, 17, 50, 0.85), rgba(8, 6, 24, 0.92));
  box-shadow: var(--shadow-lg), 0 0 90px -30px rgba(124, 58, 237, 0.55);
  overflow: hidden;
}
.dash::before {
  content: ""; position: absolute; inset: -1px; border-radius: inherit; padding: 1px; pointer-events: none;
  background: linear-gradient(130deg, rgba(139, 92, 246, 0.65), transparent 28%, transparent 68%, rgba(78, 234, 255, 0.5));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
}
.dash-top { display: flex; align-items: center; gap: 8px; padding-block-end: 12px; border-block-end: 1px solid rgba(160, 175, 230, 0.12); }
.traffic { display: inline-flex; gap: 5px; }
.traffic i { width: 9px; height: 9px; border-radius: 50%; }
.traffic i:nth-child(1) { background: #ff5f57; } .traffic i:nth-child(2) { background: #febc2e; } .traffic i:nth-child(3) { background: #28c840; }
.dash-title { margin-inline-start: 6px; font-size: 12px; font-weight: 700; color: var(--muted); font-family: var(--font-mono); letter-spacing: 0.04em; }
.dash-live { display: inline-flex; align-items: center; gap: 7px; margin-inline-start: auto; font-size: 10.5px; color: var(--lime); font-weight: 700; font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.12em; }
.dash-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding-block-start: 12px; }
.mini {
  min-width: 0; padding: 12px; border-radius: 16px;
  border: 1px solid rgba(160, 175, 230, 0.13); background: rgba(11, 9, 28, 0.65);
}
.mini.wide { grid-column: 1 / -1; }
.mini h4 { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 9px; font-size: 10.5px; font-weight: 750; color: var(--quiet); text-transform: uppercase; letter-spacing: 0.13em; }
.mini h4 em { font-style: normal; letter-spacing: 0; text-transform: none; font-family: var(--font-mono); font-size: 9.5px; color: #565f7d; }
.mini-kpi { font-family: var(--font-mono); font-size: 17px; font-weight: 700; color: var(--ink); direction: ltr; text-align: start; }
.mini-kpi small { display: block; font-size: 10px; color: var(--quiet); }
.mono, .num { font-family: var(--font-mono); }
.up { color: var(--lime); }
.down { color: var(--red); }
.flat { color: var(--muted); }
.intent-line { display: flex; gap: 9px; align-items: flex-start; padding: 8px 10px; border-radius: 11px; background: rgba(124, 58, 237, 0.1); border: 1px solid rgba(124, 58, 237, 0.28); font-size: 12px; color: #d8ccff; }
.intent-line .spark { flex: 0 0 auto; width: 16px; height: 16px; margin-block-start: 1px; }
.flow-mini { display: flex; flex-wrap: wrap; gap: 5px; margin-block-start: 9px; }
.flow-mini span { padding: 4px 8px; border-radius: 8px; border: 1px solid rgba(160, 175, 230, 0.15); font-size: 10px; color: var(--quiet); font-weight: 650; }
.sig-pill { display: inline-block; margin: 2px 4px 2px 0; padding: 4px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 700; }
.sig-strong-buy { background: rgba(99, 245, 187, 0.14); color: var(--lime); border: 1px solid rgba(99, 245, 187, 0.3); }
.sig-buy { background: rgba(78, 234, 255, 0.1); color: var(--cyan); border: 1px solid rgba(78, 234, 255, 0.25); }
.sig-watch { background: rgba(255, 196, 93, 0.1); color: var(--amber); border: 1px solid rgba(255, 196, 93, 0.25); }
.sig-sell { background: rgba(255, 107, 139, 0.1); color: #ff8ba3; border: 1px solid rgba(255, 107, 139, 0.3); }
.sig-high-risk { background: rgba(255, 77, 77, 0.12); color: var(--red); border: 1px solid rgba(255, 77, 77, 0.35); }
.mrow { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 5px 0; font-size: 12px; color: var(--muted); }
.mrow .t { font-weight: 700; color: var(--ink); }
/*
 * The row that was overflowing. A flex row with 'margin-inline-start:auto' on
 * the price has no way to say "the name is the thing that should give" — so at
 * 360px the price and the percentage rode out of the card and off the screen.
 * This is a four-track grid: the name is the only flexible track, it truncates,
 * and the price and the arrow are fixed and always fit.
 */
.mrow-coin { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 7px; padding: 6px 0; }
.mrow-coin .nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; color: var(--quiet); }
.mrow-coin .num { font-size: 11.5px; white-space: nowrap; direction: ltr; }

/* pulse strip */
.pulse { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-block-start: clamp(30px, 4vw, 44px); }
@media (min-width: 760px) { .pulse { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.pulse-card { position: relative; padding: 16px 16px 14px; border-radius: 18px; border: 1px solid var(--line); background: rgba(13, 10, 32, 0.55); overflow: hidden; }
.pulse-card::after { content: ""; position: absolute; inset-inline: 0; inset-block-end: 0; height: 2px; background: linear-gradient(90deg, var(--violet), var(--cyan)); opacity: 0.55; }
.pulse-label { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--quiet); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.pulse-value { display: block; margin-block-start: 6px; font-family: var(--font-mono); font-size: clamp(17px, 2.6vw, 21px); font-weight: 750; direction: ltr; }
[data-lang="fa"] .pulse-value { text-align: right; }
[data-lang="en"] .pulse-value { text-align: left; }
.pulse-sub { font-size: 11px; color: var(--quiet); }

/* ─────────────────────────── sections ─────────────────────────── */
.sec-head { max-width: 780px; margin-block-end: clamp(24px, 4vw, 40px); }
.sec-head.center { margin-inline: auto; text-align: center; }
.kicker {
  display: inline-flex; align-items: center; gap: 8px; margin: 0 0 14px;
  font-size: 11.5px; font-weight: 800; letter-spacing: 0.22em; text-transform: uppercase;
  color: #a890ff;
}
.kicker::before { content: ""; width: 22px; height: 2px; border-radius: 2px; background: linear-gradient(90deg, var(--violet), var(--cyan)); }
h2 { margin: 0; font-size: clamp(25px, 4.6vw, 40px); line-height: 1.18; letter-spacing: -0.02em; font-weight: 820; }
.sec-lede { margin: 14px 0 0; color: var(--muted); font-size: clamp(14.5px, 2vw, 16.5px); max-width: 68ch; }

.grid { display: grid; gap: 12px; }
.grid-2 { grid-template-columns: 1fr; }
.grid-3 { grid-template-columns: 1fr; }
.grid-4 { grid-template-columns: 1fr; }
@media (min-width: 620px) { .grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); } .grid-3, .grid-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 960px) { .grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); } .grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); } }

.card {
  position: relative; min-width: 0; padding: 20px; border-radius: var(--radius);
  border: 1px solid var(--line); background: rgba(14, 11, 34, 0.6);
  transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.25s ease;
  overflow: hidden;
}
.card:hover { transform: translateY(-3px); border-color: rgba(139, 92, 246, 0.45); box-shadow: 0 16px 40px -18px rgba(124, 58, 237, 0.5); }
.card h3 { margin: 0 0 8px; font-size: 15.5px; font-weight: 750; display: flex; align-items: center; gap: 10px; }
.card p { margin: 0; color: var(--muted); font-size: 13.5px; line-height: 1.75; }
/*
 * The icon badge. It used to be a flat rounded square with a grey glyph, and
 * ten of those in a grid read as one texture rather than ten affordances. Now
 * each card sets --ac (see the .acc-* list below) and the badge takes it: lit
 * edge, tinted fill, and a ring that turns when the pointer is on the card.
 */
.card-icon {
  position: relative; display: grid; place-items: center; width: 44px; height: 44px; flex: 0 0 44px;
  border-radius: 14px; border: 1px solid color-mix(in srgb, var(--ac, #8b5cf6) 42%, transparent);
  background:
    radial-gradient(80% 80% at 30% 20%, color-mix(in srgb, var(--ac, #8b5cf6) 26%, transparent), transparent 70%),
    rgba(11, 9, 28, 0.7);
  color: color-mix(in srgb, var(--ac, #8b5cf6) 65%, #ffffff);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.09);
  transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.3s ease, border-color 0.3s ease;
}
.card-icon::after {
  content: ""; position: absolute; inset: -1px; border-radius: 15px; pointer-events: none;
  background: conic-gradient(from 0deg, transparent 0 62%, color-mix(in srgb, var(--ac, #8b5cf6) 85%, transparent) 78%, transparent 92%);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude; -webkit-mask-composite: xor; padding: 1px;
  opacity: 0; transition: opacity 0.3s ease;
}
.card-icon svg { width: 22px; height: 22px; }
.card:hover .card-icon, .card.is-lit .card-icon { transform: translateY(-2px) rotate(-4deg) scale(1.05); box-shadow: 0 12px 26px -14px color-mix(in srgb, var(--ac, #8b5cf6) 80%, transparent); }
.card:hover .card-icon::after, .card.is-lit .card-icon::after { opacity: 1; animation: ring-turn 3.6s linear infinite; }
/* One accent per product tile, so a grid of ten is not a grid of one colour. */
.acc-swap { --ac: #8b5cf6; }
.acc-wallet { --ac: #4eeaff; }
.acc-signals { --ac: #63f5bb; }
.acc-intent { --ac: #b79cff; }
.acc-smartMoney { --ac: #ffc45d; }
.acc-farm { --ac: #7ee08b; }
.acc-orders { --ac: #ff68ca; }
.acc-lending { --ac: #5b8cff; }
.acc-stocks { --ac: #2fd6a6; }
.acc-rwa { --ac: #d8b4fe; }
.acc-ai { --ac: #00c2ff; }
.acc-explore { --ac: #ff9f6b; }
.acc-gold { --ac: #ffd166; }
.acc-futures { --ac: #ff6b8b; }
.acc-tokens { --ac: #63f5bb; }
.acc-network { --ac: #4eeaff; }
.acc-grid { --ac: #8b5cf6; }
.acc-doc { --ac: #aab2d0; }
a.card { text-decoration: none; display: block; }
.card .go { position: absolute; inset-block-start: 16px; inset-inline-end: 16px; color: var(--quiet); transition: color 0.2s, transform 0.2s; }
.card:hover .go { color: var(--cyan); transform: translate(2px, -2px); }
html[dir="rtl"] .card:hover .go { transform: translate(-2px, -2px) scaleX(-1); }
html[dir="rtl"] .card .go { transform: scaleX(-1); }
.tag {
  display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 10px; font-weight: 750;
  letter-spacing: 0.06em; text-transform: uppercase;
}
.tag-live { color: var(--lime); background: rgba(99, 245, 187, 0.1); border: 1px solid rgba(99, 245, 187, 0.28); }
.tag-info { color: var(--cyan); background: rgba(78, 234, 255, 0.08); border: 1px solid rgba(78, 234, 255, 0.24); }
.tag-soon { color: var(--amber); background: rgba(255, 196, 93, 0.09); border: 1px solid rgba(255, 196, 93, 0.26); }

/* quote / example blocks */
.intent-quote {
  position: relative; margin: 0 0 22px; padding: 20px 22px; border-radius: 18px;
  border: 1px solid rgba(139, 92, 246, 0.35);
  background: linear-gradient(140deg, rgba(124, 58, 237, 0.14), rgba(78, 234, 255, 0.05));
  font-size: clamp(15px, 2.4vw, 18px); font-weight: 650; color: #e6ddff;
}
.intent-quote .q-label { display: block; margin-block-end: 8px; font-size: 11px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: #9f8aec; }
.stamp { position: absolute; inset-block-start: 14px; inset-inline-end: 14px; }

/* vertical AI pipeline */
.flow { position: relative; display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; counter-reset: step; }
.flow li {
  position: relative; display: flex; align-items: center; gap: 14px;
  padding: 13px 16px; border-radius: 15px;
  border: 1px solid var(--line); background: rgba(13, 10, 32, 0.6);
  opacity: 0; transform: translateY(14px); transition: opacity 0.5s ease, transform 0.5s ease;
  transition-delay: calc(var(--i) * 70ms);
}
.flow li.on, html:not([data-js]) .flow li { opacity: 1; transform: none; }
.flow li::before {
  counter-increment: step; content: counter(step, decimal-leading-zero);
  display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 34px;
  border-radius: 11px; font-family: var(--font-mono); font-size: 11.5px; font-weight: 700; color: #c9baff;
  border: 1px solid rgba(139, 92, 246, 0.4);
  background: linear-gradient(140deg, rgba(124, 58, 237, 0.25), rgba(78, 234, 255, 0.08));
  direction: ltr;
}
.flow li b { font-size: 14.5px; font-weight: 720; }
.flow li.approve { border-color: rgba(99, 245, 187, 0.4); background: rgba(99, 245, 187, 0.06); }
.flow li.approve::before { border-color: rgba(99, 245, 187, 0.5); color: var(--lime); background: rgba(99, 245, 187, 0.1); }
@media (min-width: 920px) {
  .flow { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
}
.note-inline { display: flex; gap: 12px; align-items: flex-start; margin-block-start: 18px; padding: 15px 17px; border-radius: 15px; border: 1px solid rgba(99, 245, 187, 0.26); background: rgba(99, 245, 187, 0.05); font-size: 13.5px; color: #cfeeda; }
.note-inline.warn { border-color: rgba(255, 196, 93, 0.3); background: rgba(255, 196, 93, 0.05); color: #ffe3ae; }

/* personalization chips */
.say-grid { display: grid; gap: 10px; margin-block-start: 20px; }
@media (min-width: 760px) { .say-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.say-card { padding: 15px 16px; border-radius: 15px; border: 1px dashed rgba(139, 92, 246, 0.4); background: rgba(124, 58, 237, 0.07); }
.say-card .s1 { font-size: 13.5px; font-weight: 650; color: #e2d8ff; }
.say-card .s2 { display: inline-flex; align-items: center; gap: 7px; margin-block-start: 9px; font-size: 12px; font-weight: 750; color: var(--cyan); }
.say-card .s2::before { content: "→"; }
html[dir="rtl"] .say-card .s2::before { content: "←"; }

/* ─────────────────────────── data tables / rows ─────────────────────────── */
.data-shell { border: 1px solid var(--line); border-radius: var(--radius-lg); background: rgba(12, 9, 30, 0.6); overflow: hidden; }
.data-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 16px; border-block-end: 1px solid var(--line); font-size: 11.5px; color: var(--quiet); }
.data-head .spacer { flex: 1; }
.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
table.market { width: 100%; min-width: 680px; border-collapse: collapse; font-size: 13px; }
table.market th { padding: 11px 14px; text-align: start; font-size: 10.5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--quiet); border-block-end: 1px solid var(--line); white-space: nowrap; }
table.market td { padding: 11px 14px; border-block-end: 1px solid rgba(160, 175, 230, 0.07); white-space: nowrap; }
table.market tr:last-child td { border-block-end: 0; }
.coin-cell { display: flex; align-items: center; gap: 10px; min-width: 0; }
.coin-cell img { width: 26px; height: 26px; border-radius: 50%; flex: 0 0 26px; background: #191533; }
.coin-cell .sym { font-weight: 750; font-size: 13px; }
.coin-cell .name { display: block; font-size: 10.5px; color: var(--quiet); }
.coin-cell .rank { font-family: var(--font-mono); font-size: 10px; color: var(--quiet); margin-inline-end: 2px; }
td .num { direction: ltr; display: inline-block; }
.spark { display: block; width: 104px; height: 30px; }
html[dir="rtl"] .spark { transform: scaleX(-1); }
.chg { display: inline-flex; align-items: center; gap: 3px; font-family: var(--font-mono); font-size: 12px; font-weight: 700; direction: ltr; }
html[dir="rtl"] td .num, html[dir="rtl"] .chg { direction: ltr; }

/*
 * Direction, not percentage. 18px square, tinted, with a 1px ring; the figure
 * is in the title attribute for anyone who wants the magnitude. '.flat' is the
 * pre-data state (a dash) and it never animates, so a page whose API is down
 * shows a still grey tile rather than a row of blinking nothing.
 */
.chg-arrow {
  display: inline-grid; place-items: center; width: 22px; height: 22px; flex: 0 0 22px;
  border-radius: 8px; font-size: 10px; line-height: 1; cursor: help;
  border: 1px solid transparent; background: rgba(160, 175, 230, 0.08); color: var(--quiet);
  transition: transform 0.2s ease;
}
.chg-arrow.up { color: var(--lime); background: rgba(99, 245, 187, 0.13); border-color: rgba(99, 245, 187, 0.34); animation: arrow-up 2.6s ease-in-out infinite; }
.chg-arrow.down { color: var(--red); background: rgba(255, 107, 139, 0.13); border-color: rgba(255, 107, 139, 0.34); animation: arrow-down 2.6s ease-in-out infinite; }
.chg-arrow.flat { font-size: 8px; }
tr:hover .chg-arrow, .rowline:hover .chg-arrow, .tape-item:hover .chg-arrow { transform: scale(1.16); }
@keyframes arrow-up { 0%, 100% { transform: translateY(0.5px); } 50% { transform: translateY(-1.2px); } }
@keyframes arrow-down { 0%, 100% { transform: translateY(-0.5px); } 50% { transform: translateY(1.2px); } }
/* the change column is now an 18px tile: no min-width needed for it to fit */
table.market { min-width: 560px; }
@media (max-width: 760px) {
  table.market { min-width: 0; font-size: 12.5px; }
  table.market th:nth-child(4), table.market td:nth-child(4),
  table.market th:nth-child(5), table.market td:nth-child(5) { display: none; }
}

/* cards variant for narrow screens where a table is too wide */
.rows { display: grid; }
.rowline { display: flex; align-items: center; gap: 12px; padding: 13px 16px; border-block-end: 1px solid rgba(160, 175, 230, 0.08); }
.rowline:last-child { border-block-end: 0; }
.rowline .grow { flex: 1; min-width: 0; }
.rowline .name { font-weight: 720; font-size: 13.5px; }
.rowline .sub { font-size: 11px; color: var(--quiet); }
.rowline .val { text-align: end; }
.rowline .val .sub { direction: ltr; }

/* skeletons */
.skel { position: relative; overflow: hidden; background: rgba(160, 175, 230, 0.09); border-radius: 8px; }
.skel::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(220, 230, 255, 0.09), transparent);
  animation: shimmer 1.4s infinite;
}
@keyframes shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
html[dir="rtl"] .skel::after { animation-name: shimmer-rtl; }
@keyframes shimmer-rtl { from { transform: translateX(100%); } to { transform: translateX(-100%); } }
.skel-row { display: flex; gap: 12px; align-items: center; padding: 13px 16px; border-block-end: 1px solid rgba(160, 175, 230, 0.07); }
.skel-dot { width: 26px; height: 26px; border-radius: 50%; flex: 0 0 26px; }
.skel-line { height: 12px; flex: 1; max-width: 160px; }
.skel-line.sh { max-width: 74px; margin-inline-start: auto; }

.empty-state { padding: 30px 20px; text-align: center; color: var(--quiet); font-size: 13px; }
.retry-btn { display: inline-flex; margin-block-start: 10px; padding: 8px 16px; border-radius: 10px; border: 1px solid var(--line); background: transparent; color: var(--cyan); font-weight: 700; font-size: 12.5px; cursor: pointer; }
.retry-btn:hover { border-color: var(--cyan); }

/* filter chips (farms) */
.filter-row { display: flex; flex-wrap: wrap; gap: 7px; margin-block-end: 16px; }
.filter-chip { padding: 8px 14px; border-radius: 999px; border: 1px solid var(--line); background: rgba(13, 10, 32, 0.55); color: var(--muted); font-size: 12.5px; font-weight: 700; cursor: pointer; transition: all 0.18s; }
.filter-chip[aria-pressed="true"] { color: #fff; border-color: var(--violet); background: linear-gradient(120deg, rgba(124, 58, 237, 0.5), rgba(91, 140, 255, 0.4)); }

/* risk badges */
.rb { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 750; }
.rb-low { color: var(--lime); background: rgba(99, 245, 187, 0.1); border: 1px solid rgba(99, 245, 187, 0.25); }
.rb-medium { color: var(--amber); background: rgba(255, 196, 93, 0.09); border: 1px solid rgba(255, 196, 93, 0.25); }
.rb-high { color: var(--red); background: rgba(255, 107, 139, 0.1); border: 1px solid rgba(255, 107, 139, 0.28); }

/* networks */
.net-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (min-width: 640px) { .net-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (min-width: 960px) { .net-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
.net-card { display: flex; align-items: center; gap: 11px; padding: 14px 15px; border-radius: 16px; border: 1px solid var(--line); background: rgba(14, 11, 34, 0.6); transition: transform 0.2s, border-color 0.2s; }
.net-card:hover { transform: translateY(-2px); border-color: rgba(139, 92, 246, 0.4); }
.net-orb { width: 30px; height: 30px; flex: 0 0 30px; border-radius: 50%; border: 1.5px solid var(--nc, var(--violet)); background: radial-gradient(circle at 32% 30%, color-mix(in srgb, var(--nc, var(--violet)) 55%, transparent), rgba(10, 8, 24, 0.9) 72%); box-shadow: 0 0 14px -2px var(--nc, var(--violet)); }
.net-card b { font-size: 13px; font-weight: 720; display: block; }
.net-card small { font-size: 10.5px; color: var(--quiet); }

/* compare: old way vs intent */
.vs-grid { display: grid; gap: 12px; }
@media (min-width: 860px) { .vs-grid { grid-template-columns: 1fr 1.1fr; } }
.vs-old { padding: 18px; border-radius: var(--radius); border: 1px dashed rgba(255, 107, 139, 0.35); background: rgba(255, 107, 139, 0.04); }
.vs-old .lbl { color: #ff8ba3; }
.vs-chain { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-block-start: 12px; font-family: var(--font-mono); font-size: 11px; color: var(--muted); direction: ltr; }
.vs-chain span { padding: 5px 9px; border-radius: 8px; border: 1px solid rgba(160, 175, 230, 0.18); background: rgba(12, 9, 30, 0.6); }
.vs-chain i { color: var(--quiet); font-style: normal; }
.vs-new { padding: 18px; border-radius: var(--radius); border: 1px solid rgba(99, 245, 187, 0.3); background: rgba(99, 245, 187, 0.05); }
.vs-lbl { font-size: 11px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; }
.vs-new .vs-lbl { color: var(--lime); }
.vs-flow { display: flex; flex-wrap: wrap; gap: 7px; margin-block-start: 14px; }
.vs-flow span { padding: 7px 12px; border-radius: 10px; font-size: 12px; font-weight: 700; border: 1px solid rgba(99, 245, 187, 0.3); color: #d9ffee; background: rgba(99, 245, 187, 0.07); }
.vs-flow span.user { border-color: rgba(139, 92, 246, 0.55); background: rgba(124, 58, 237, 0.16); color: #e5dbff; }
.vs-flow i { align-self: center; color: var(--quiet); font-style: normal; }
html[dir="rtl"] .vs-flow i, html[dir="rtl"] .vs-chain i { transform: scaleX(-1); display: inline-block; }

/* fee panel */
.fee-panel { display: grid; gap: 18px; margin-block-start: 28px; padding: clamp(20px, 3vw, 30px); align-items: center; }
@media (min-width: 860px) { .fee-panel { grid-template-columns: auto 1fr; gap: 34px; } }
.fee-figure { font-family: var(--font-mono); font-size: clamp(44px, 8vw, 72px); font-weight: 800; line-height: 1; background: linear-gradient(120deg, var(--cyan), var(--lime)); -webkit-background-clip: text; background-clip: text; color: transparent; direction: ltr; text-align: center; }
.fee-copy p { margin: 0; color: var(--muted); font-size: 14px; }
.fee-copy strong { color: var(--ink); }

/* stats / dashboard cards */
.stat-grid { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 860px) { .stat-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.stat-card { padding: 17px; border-radius: var(--radius); border: 1px solid var(--line); background: rgba(14, 11, 34, 0.6); }
.stat-card .t { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--quiet); }
.stat-card .v { display: block; margin-block-start: 8px; font-family: var(--font-mono); font-size: clamp(18px, 3vw, 24px); font-weight: 750; direction: ltr; }
html[dir="rtl"] .stat-card .v { text-align: right; }
.stat-card .u { font-size: 11px; color: var(--quiet); }

/* opportunities */
.opp-card { min-height: 100%; }
.opp-list { display: grid; gap: 8px; margin-block-start: 14px; }
.opp-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(160, 175, 230, 0.12); background: rgba(10, 8, 24, 0.55); font-size: 12.5px; }
.opp-item img { width: 22px; height: 22px; border-radius: 50%; background: #191533; }
.opp-item .grow { flex: 1; min-width: 0; font-weight: 700; }
.opp-item .meta { font-size: 10.5px; color: var(--quiet); }

/* faq */
.faq-list details { border: 1px solid var(--line); border-radius: 16px; background: rgba(14, 11, 34, 0.6); margin-block-end: 10px; overflow: hidden; transition: border-color 0.2s; }
.faq-list details[open] { border-color: rgba(139, 92, 246, 0.45); }
.faq-list summary { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px 18px; cursor: pointer; font-weight: 720; font-size: 14.5px; list-style: none; }
.faq-list summary::-webkit-details-marker { display: none; }
.faq-plus { display: grid; place-items: center; width: 26px; height: 26px; flex: 0 0 26px; border-radius: 9px; border: 1px solid rgba(160, 175, 230, 0.25); color: var(--cyan); font-size: 16px; font-weight: 400; transition: transform 0.2s, background 0.2s; }
.faq-list details[open] .faq-plus { background: rgba(78, 234, 255, 0.12); transform: rotate(45deg); }
.faq-list details .a { padding: 0 18px 17px; margin: 0; color: var(--muted); font-size: 13.5px; line-height: 1.85; max-width: 72ch; }

/* final cta */
.cta-band {
  position: relative; text-align: center; padding: clamp(36px, 6vw, 72px) clamp(20px, 4vw, 48px);
  border-radius: var(--radius-lg); overflow: hidden;
  border: 1px solid rgba(139, 92, 246, 0.4);
  background:
    radial-gradient(600px 300px at 50% -30%, rgba(124, 58, 237, 0.4), transparent 65%),
    linear-gradient(165deg, rgba(23, 17, 54, 0.9), rgba(8, 6, 24, 0.95));
  box-shadow: var(--shadow-lg);
}
.cta-band h2 { font-size: clamp(26px, 5vw, 44px); }
.cta-band p { margin: 14px auto 26px; max-width: 54ch; color: var(--muted); font-size: 15.5px; }
.cta-band .hero-actions { justify-content: center; margin-block-start: 0; }

/* risk strip */
.risk-panel { display: flex; gap: 15px; padding: 19px 21px; border-radius: var(--radius); border: 1px solid rgba(255, 196, 93, 0.28); background: linear-gradient(135deg, rgba(77, 48, 18, 0.4), rgba(20, 15, 24, 0.6)); }
.risk-mark { display: grid; place-items: center; width: 30px; height: 30px; flex: 0 0 30px; border-radius: 10px; border: 1px solid rgba(255, 196, 93, 0.45); color: var(--amber); font-weight: 900; font-family: var(--font-mono); }
.risk-panel h3 { margin: 0 0 5px; font-size: 14px; color: #ffe4b5; }
.risk-panel p { margin: 0; color: #d5c8b2; font-size: 13px; line-height: 1.85; }

/* footer */
/* The bottom padding clears the fixed circle (68px + its margin + the iOS
   home indicator), otherwise the last footer line sits under it. */
footer.site { margin-block-start: 30px; border-block-start: 1px solid var(--line); padding: clamp(30px, 4vw, 48px) 0 calc(112px + env(safe-area-inset-bottom)); }
.foot-grid { display: grid; gap: 26px; grid-template-columns: 1fr; }
@media (min-width: 700px) { .foot-grid { grid-template-columns: 1.3fr 2fr; } }
.foot-col h4 { margin: 0 0 12px; font-size: 11px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: var(--quiet); }
.foot-col ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.foot-col a { color: var(--muted); font-size: 13px; text-decoration: none; }
.foot-col a:hover { color: var(--cyan); }
.foot-links { display: grid; gap: 22px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 1024px) { .foot-links { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.foot-brand p { margin: 12px 0 0; color: var(--muted); font-size: 13px; max-width: 42ch; }
.foot-note { margin-block-start: 26px; padding-block-start: 20px; border-block-start: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 10px 22px; align-items: center; justify-content: space-between; color: var(--quiet); font-size: 12px; }
.foot-note a { color: var(--muted); text-decoration: none; }
.foot-note a:hover { color: var(--cyan); }

/* ─────────────────────────── the bottom dock ─────────────────────────── */
/*
 * The expandable menu in a circle at the bottom of the viewport.
 *
 * Structure worth keeping straight when editing: an invisible checkbox
 * (#dock-state) owns the open state, a <label> is the circle, and the panel is
 * a sibling — so ':checked ~' opens it with no JavaScript. The script only adds
 * what JS is good at: closing after a pick, Escape, and the ring that shows
 * how far down the page you are.
 *
 * It is 'position: fixed' and never hides itself. It tucks to 92% while you are
 * scrolling down and returns when you scroll up, so it stays out of the way of
 * a paragraph without ever disappearing on someone who needs it.
 */
.dock { position: fixed; inset-inline: 0; inset-block-end: 0; z-index: 55; display: flex; flex-direction: column; align-items: center; pointer-events: none; }
.dock-state { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
.dock-orb {
  position: relative; z-index: 3; pointer-events: auto; cursor: pointer; margin-block-end: max(18px, env(safe-area-inset-bottom));
  width: 68px; height: 68px; border-radius: 50%; display: grid; place-items: center;
  background: radial-gradient(120% 120% at 30% 20%, rgba(139, 92, 246, 0.9), rgba(38, 22, 84, 0.96) 62%, rgba(9, 7, 24, 0.98));
  border: 1px solid rgba(139, 92, 246, 0.5);
  box-shadow: 0 18px 40px -14px rgba(0, 0, 0, 0.8), 0 0 34px -6px rgba(124, 58, 237, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  transition: transform 0.28s cubic-bezier(0.2, 0.9, 0.2, 1), box-shadow 0.28s ease, border-color 0.2s;
  animation: orb-in 0.6s ease 0.4s both;
}
@keyframes orb-in { from { transform: translateY(90px) scale(0.6); opacity: 0; } to { transform: none; opacity: 1; } }
.dock.is-tucked .dock-orb { transform: scale(0.9); box-shadow: 0 10px 24px -14px rgba(0, 0, 0, 0.7), 0 0 20px -8px rgba(124, 58, 237, 0.5); }
.dock-orb:hover { border-color: rgba(78, 234, 255, 0.7); box-shadow: 0 18px 40px -14px rgba(0, 0, 0, 0.8), 0 0 44px -4px rgba(78, 234, 255, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.2); }
.dock-orb:active { transform: scale(0.94); }
.dock-state:focus-visible ~ .dock-orb { outline: 2px solid var(--cyan); outline-offset: 3px; }
.dock-orb-glow {
  position: absolute; inset: -6px; border-radius: 50%; pointer-events: none;
  background: conic-gradient(from 140deg, rgba(139, 92, 246, 0.5), rgba(78, 234, 255, 0.5), rgba(99, 245, 187, 0.4), rgba(139, 92, 246, 0.5));
  filter: blur(14px); opacity: 0.5; animation: ring-turn 9s linear infinite; z-index: -1;
}
.dock-orb-face { position: relative; display: grid; place-items: center; color: #fff; }
.dock-orb-face .ic { width: 26px; height: 26px; }
.dock-ic-open, .dock-ic-close { grid-area: 1 / 1; display: grid; place-items: center; transition: transform 0.3s cubic-bezier(0.2, 0.9, 0.2, 1), opacity 0.2s; }
.dock-ic-close { opacity: 0; transform: rotate(-90deg) scale(0.6); }
.dock-state:checked ~ .dock-orb .dock-ic-open { opacity: 0; transform: rotate(90deg) scale(0.6); }
.dock-state:checked ~ .dock-orb .dock-ic-close { opacity: 1; transform: none; }
.dock-ring { position: absolute; inset: -5px; width: calc(100% + 10px); height: calc(100% + 10px); transform: rotate(-90deg); pointer-events: none; }
.dock-ring circle { fill: none; stroke-width: 2.2; }
.dock-ring-track { stroke: rgba(160, 175, 230, 0.18); }
.dock-ring-fill { stroke: url(#fbt-ink); stroke-linecap: round; stroke-dasharray: 100; stroke-dashoffset: 100; transition: stroke-dashoffset 0.2s linear; }
.dock-scrim {
  position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: 0;
  background: radial-gradient(120% 80% at 50% 108%, rgba(6, 4, 18, 0.86), rgba(6, 4, 18, 0.5) 46%, transparent 72%);
  backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
  transition: opacity 0.3s ease;
}
.dock-menu {
  position: relative; z-index: 2; pointer-events: none;
  width: min(660px, calc(100% - 24px)); margin-block-end: 12px;
  max-height: min(72vh, 620px); overflow: auto; overscroll-behavior: contain;
  padding: 14px 14px 12px; border-radius: 26px;
  border: 1px solid rgba(139, 92, 246, 0.32);
  background: linear-gradient(170deg, rgba(24, 18, 54, 0.94), rgba(8, 6, 22, 0.96));
  box-shadow: var(--shadow-lg), 0 0 60px -22px rgba(124, 58, 237, 0.7);
  backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
  opacity: 0; transform: translateY(26px) scale(0.97); transform-origin: 50% 100%;
  transition: opacity 0.26s ease, transform 0.3s cubic-bezier(0.2, 0.9, 0.2, 1);
}
.dock-state:checked ~ .dock-menu, .dock.is-open .dock-menu { opacity: 1; transform: none; pointer-events: auto; }
.dock-state:checked ~ .dock-scrim { opacity: 1; pointer-events: auto; }
.dock-head { display: flex; align-items: center; gap: 12px; padding: 2px 4px 10px; }
.dock-title { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; letter-spacing: 0.04em; color: #dcd4ff; }
.dock-title .ic { width: 16px; height: 16px; color: var(--cyan); }
.dock-prog { flex: 1; height: 3px; border-radius: 3px; background: rgba(160, 175, 230, 0.16); overflow: hidden; }
.dock-prog i { display: block; height: 100%; width: calc(var(--sp, 0) * 100%); background: linear-gradient(90deg, var(--violet), var(--cyan)); border-radius: 3px; }
.dock-hint { margin: 0 4px 12px; font-size: 12px; line-height: 1.7; color: var(--quiet); max-width: 56ch; }
.dock-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
@media (min-width: 520px) { .dock-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.dock-tile {
  display: flex; align-items: center; gap: 9px; padding: 11px 12px; border-radius: 15px;
  border: 1px solid rgba(160, 175, 230, 0.14); background: rgba(14, 11, 34, 0.7); color: var(--muted);
  font-size: 13px; font-weight: 700; text-decoration: none; position: relative; overflow: hidden;
  transition: transform 0.2s ease, border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
}
.dock-tile .ic { width: 18px; height: 18px; color: #bdb0ff; }
.dock-tile span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dock-tile .dock-out { position: absolute; inset-block-start: 7px; inset-inline-end: 9px; font-size: 10px; color: var(--quiet); font-style: normal; }
.dock-tile:hover { color: #fff; border-color: rgba(78, 234, 255, 0.5); background: rgba(24, 18, 54, 0.9); transform: translateY(-2px); }
.dock-tile.is-active { border-color: rgba(139, 92, 246, 0.6); color: #fff; }
.dock.is-open .dock-tile { animation: tile-in 0.42s cubic-bezier(0.2, 0.9, 0.2, 1) both; animation-delay: calc(var(--i) * 26ms); }
@keyframes tile-in { from { opacity: 0; transform: translateY(14px) scale(0.96); } to { opacity: 1; transform: none; } }
.dock-foot { display: flex; align-items: center; gap: 10px; margin-block-start: 12px; padding-top: 12px; border-block-start: 1px solid rgba(160, 175, 230, 0.12); flex-wrap: wrap; }
.dock-launch { flex: 1; min-width: 180px; padding: 13px 18px; font-size: 14.5px; }
@media (max-width: 520px) { .dock { padding-inline: 0; } }

/* ─────────────────────────── the product tour ─────────────────────────── */
/*
 * The slideshow. The stage is 'position: relative' with the slides absolutely
 * stacked inside it, and the FIRST slide is in normal flow so the stage is
 * always exactly as tall as a slide is — no fixed aspect-ratio guessing, no
 * layout shift when the art loads, and the height follows the longest copy of
 * the two languages.
 *
 * Without JS (or before it runs) every slide is a visible stacked section: a
 * crawler and a reader with scripting off get all five pages, not a static
 * first frame. 'html[data-js]' is what arms the carousel.
 */
.showcase { position: relative; }
.show {
  position: relative; overflow: hidden; border-radius: 28px;
  border: 1px solid rgba(160, 175, 230, 0.16);
  background: linear-gradient(168deg, rgba(22, 17, 50, 0.9), rgba(8, 6, 24, 0.95));
  box-shadow: var(--shadow-lg), 0 0 90px -40px color-mix(in srgb, var(--sh-accent, #8b5cf6) 70%, transparent);
  transition: box-shadow 0.5s ease;
}
.show-stage { position: relative; --drag: 0px; }
.show-slide { position: relative; display: grid; gap: 18px; padding: clamp(20px, 3.4vw, 34px); grid-template-columns: 1fr; align-items: center; }
@media (min-width: 860px) { .show-slide { grid-template-columns: 1.02fr 0.98fr; gap: 26px; } }
.show-slide .slide-plate {
  position: relative; border-radius: 20px; overflow: hidden; isolation: isolate;
  border: 1px solid rgba(160, 175, 230, 0.16); background: #0b091c;
  transform: translate3d(calc(var(--px, 0px) + var(--drag, 0px)), var(--py, 0px), 0);
  transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.slide-plate img { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: cover; animation: ken-burns 22s ease-in-out infinite alternate; }
@keyframes ken-burns { from { transform: scale(1.02) translate3d(0, 0, 0); } to { transform: scale(1.13) translate3d(-1.6%, -2.2%, 0); } }
.slide-veil { position: absolute; inset: 0; background: linear-gradient(160deg, rgba(124, 58, 237, 0.2), transparent 42%, rgba(6, 4, 18, 0.72)); mix-blend-mode: screen; }
.slide-lines { position: absolute; inset: 0; opacity: 0.5; background-image: repeating-linear-gradient(115deg, rgba(255, 255, 255, 0.06) 0 1px, transparent 1px 26px); mask-image: linear-gradient(115deg, #000, transparent 70%); animation: lines-slide 9s linear infinite; }
@keyframes lines-slide { to { background-position: 260px 0; } }
.slide-tag { display: inline-flex; align-items: center; gap: 8px; margin: 0; font-size: 11px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: color-mix(in srgb, var(--sh-accent, #8b5cf6) 70%, #ffffff); }
.slide-tag .ic { width: 17px; height: 17px; }
.show-slide h3 { margin: 10px 0 0; font-size: clamp(20px, 3.2vw, 30px); line-height: 1.22; letter-spacing: -0.02em; font-weight: 820; }
.slide-d { margin: 12px 0 0; color: var(--muted); font-size: clamp(13.5px, 1.6vw, 15px); line-height: 1.8; max-width: 56ch; }
.slide-bullets { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 8px; }
.slide-bullets li { display: flex; align-items: flex-start; gap: 9px; font-size: 13px; color: #d6dcf5; }
.slide-bullets li span { min-width: 0; }
.slide-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-block-start: 20px; }
.slide-live {
  display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px;
  border: 1px solid rgba(99, 245, 187, 0.28); background: rgba(99, 245, 187, 0.07);
  font-size: 12px; font-weight: 700; color: #cfeeda;
}
.slide-live .k { font-family: var(--font-mono); color: #fff; }
.slide-live .v { font-family: var(--font-mono); direction: ltr; }
.slide-live.is-off { display: none; }
.slide-lottie { position: absolute; inset-block-start: 8%; inset-inline-end: 4%; width: clamp(120px, 18%, 200px); opacity: 0.9; pointer-events: none; }
@media (max-width: 860px) { .slide-lottie { display: none; } }
.slide-index { position: absolute; inset-block-end: 10px; inset-inline-end: 14px; font-family: var(--font-mono); font-size: 11px; color: var(--quiet); letter-spacing: 0.12em; }
.slide-index i { font-style: normal; margin-inline: 2px; opacity: 0.5; }
.lottie { display: block; width: 100%; aspect-ratio: 1; }
.lot { width: 100%; height: 100%; display: block; overflow: visible; filter: drop-shadow(0 0 18px rgba(124, 58, 237, 0.35)); }
.lot-off { display: none; }
.lottie-inline { width: 34px; height: 34px; flex: 0 0 34px; }
.lottie-quote { position: absolute; inset-block-start: -34px; inset-inline-end: 10px; width: 84px; height: 84px; opacity: 0.75; }

/* the chrome: arrows, dots, progress */
.show-nav {
  position: absolute; inset-block-start: 50%; transform: translateY(-50%); z-index: 3;
  width: 42px; height: 42px; border-radius: 14px; display: grid; place-items: center; cursor: pointer;
  border: 1px solid rgba(160, 175, 230, 0.22); background: rgba(10, 8, 26, 0.7); color: var(--ink);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  opacity: 0; transition: opacity 0.25s ease, transform 0.25s ease, border-color 0.2s, background 0.2s;
}
.show:hover .show-nav, .show:focus-within .show-nav, .show-nav:active { opacity: 1; }
.show-nav:hover { border-color: var(--cyan); background: rgba(24, 18, 54, 0.9); }
.show-nav.is-prev { inset-inline-start: 12px; }
.show-nav.is-next { inset-inline-end: 12px; }
@media (max-width: 860px) { .show-nav { opacity: 1; width: 36px; height: 36px; } }
.show-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px 14px; border-block-start: 1px solid rgba(160, 175, 230, 0.1); flex-wrap: wrap; }
.show-dots { display: flex; align-items: center; gap: 6px; }
.show-dot {
  width: 38px; height: 34px; border-radius: 11px; display: grid; place-items: center; cursor: pointer;
  border: 1px solid rgba(160, 175, 230, 0.16); background: rgba(12, 9, 30, 0.6); color: var(--quiet);
  transition: color 0.2s, border-color 0.2s, transform 0.2s, background 0.2s;
}
.show-dot .ic { width: 16px; height: 16px; }
.show-dot:hover { color: var(--ink); transform: translateY(-2px); }
.show-dot.on { color: #fff; border-color: color-mix(in srgb, var(--sh-accent, #8b5cf6) 70%, transparent); background: color-mix(in srgb, var(--sh-accent, #8b5cf6) 22%, rgba(12, 9, 30, 0.6)); }
.show-play { display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px; border-radius: 999px; cursor: pointer; border: 1px solid var(--line); background: rgba(12, 9, 30, 0.6); color: var(--muted); font-size: 12px; font-weight: 700; }
.show-play-ic { width: 10px; height: 10px; border-radius: 50%; background: var(--lime); box-shadow: 0 0 10px var(--lime); animation: pulse-dot 2.2s ease-in-out infinite; }
.show.is-paused .show-play-ic { background: var(--quiet); box-shadow: none; animation: none; }
.show-progress { position: absolute; inset-inline: 0; inset-block-end: 0; height: 2px; background: rgba(160, 175, 230, 0.12); }
.show-progress i { display: block; height: 100%; width: calc(var(--p, 0) * 100%); background: linear-gradient(90deg, var(--violet), var(--cyan), var(--lime)); box-shadow: 0 0 12px rgba(78, 234, 255, 0.6); }
.show[data-accent="violet"] { --sh-accent: #8b5cf6; }
.show[data-accent="cyan"] { --sh-accent: #4eeaff; }
.show[data-accent="pink"] { --sh-accent: #ff68ca; }
.show[data-accent="amber"] { --sh-accent: #ffc45d; }
.show[data-accent="lime"] { --sh-accent: #63f5bb; }
/* Only armed once JS is running, and then only the active slide is visible. */
html[data-js] .show-stage { contain: layout paint; }
html[data-js] .show-slide { position: absolute; inset: 0; opacity: 0; visibility: hidden; transform: translateX(26px) scale(0.985); pointer-events: none; transition: opacity 0.5s ease, transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s linear 0.5s; }
html[data-js] .show-slide.is-on { position: relative; opacity: 1; visibility: visible; transform: none; pointer-events: auto; transition-delay: 0s, 0s, 0s; }
html[dir="rtl"][data-js] .show-slide { transform: translateX(-26px) scale(0.985); }
.show.is-drag .show-slide.is-on { transform: translateX(var(--drag)); transition: none; }
html[data-js] .show-slide.is-on .slide-body > * { animation: copy-in 0.6s cubic-bezier(0.2, 0.9, 0.2, 1) both; }
html[data-js] .show-slide.is-on .slide-body > *:nth-child(2) { animation-delay: 70ms; }
html[data-js] .show-slide.is-on .slide-body > *:nth-child(3) { animation-delay: 130ms; }
html[data-js] .show-slide.is-on .slide-body > *:nth-child(4) { animation-delay: 190ms; }
html[data-js] .show-slide.is-on .slide-body > *:nth-child(5) { animation-delay: 250ms; }
@keyframes copy-in { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
.show-stage.is-drag { cursor: grabbing; }

/* ─────────────────────────── AI token tape ─────────────────────────── */
/* The strip beside the AI panel: logo, symbol, price, arrow — one line, and
   it scrolls instead of pushing anything off the page. */
.ai-tape { margin-block-start: clamp(22px, 3vw, 34px); border: 1px solid var(--line); border-radius: 22px; background: linear-gradient(180deg, rgba(18, 14, 40, 0.6), rgba(9, 7, 24, 0.72)); overflow: hidden; }
.ai-tape.is-off { display: none; }
.ai-tape-head { display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-block-end: 1px solid rgba(160, 175, 230, 0.1); font-size: 11.5px; color: var(--quiet); }
.ai-tape-label { display: inline-flex; align-items: center; gap: 9px; min-width: 0; color: var(--muted); font-weight: 700; }
.ai-tape-label b { font-weight: 700; font-size: 12px; }
.ai-tape .spacer { flex: 1; }
.ai-tape-note { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.ai-tape-view { position: relative; overflow: hidden; mask-image: linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent); padding-block: 4px; }
.ai-tape-track { display: flex; align-items: center; gap: 8px; width: max-content; padding: 8px 12px; animation: tape-roll 44s linear infinite; }
.ai-tape-view:hover .ai-tape-track { animation-play-state: paused; }
@keyframes tape-roll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
/* In RTL the track runs from the container's right edge leftwards, so the
   second copy sits to the LEFT and the loop must travel the other way or a
   blank gap opens at the right edge. */
html[dir="rtl"] .ai-tape-track { animation-name: tape-roll-rtl; }
@keyframes tape-roll-rtl { from { transform: translateX(0); } to { transform: translateX(50%); } }
.tape-item { display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px; border-radius: 999px; border: 1px solid rgba(160, 175, 230, 0.13); background: rgba(12, 9, 30, 0.55); font-size: 12px; white-space: nowrap; }
.tape-item img { width: 18px; height: 18px; border-radius: 50%; background: #191533; }
.tape-mono { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; font-size: 10px; font-weight: 800; color: #cbb9ff; background: rgba(139, 92, 246, 0.18); }
.tape-item b { font-weight: 750; }
.tape-item .num { font-family: var(--font-mono); font-size: 11.5px; color: var(--ink); direction: ltr; }
.tape-item.is-skel { opacity: 0.6; }

/* ─────────────────────────── art panels ─────────────────────────── */
.art-panel { position: relative; margin: 0; border-radius: 24px; overflow: hidden; border: 1px solid rgba(160, 175, 230, 0.16); background: #0b091c; transform: translate3d(var(--px, 0px), var(--py, 0px), 0); transition: transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1); }
.art-panel img { display: block; width: 100%; height: auto; aspect-ratio: 4 / 3; object-fit: cover; transform: scale(1.02); transition: transform 0.9s cubic-bezier(0.2, 0.8, 0.2, 1); }
.art-panel:hover img { transform: scale(1.08); }
.art-panel figcaption { position: relative; padding: 14px 16px 16px; font-size: 12.5px; line-height: 1.75; color: var(--muted); background: linear-gradient(0deg, rgba(8, 6, 22, 0.92), rgba(8, 6, 22, 0.4)); }
.art-sheen { position: absolute; inset-block: 0; inset-inline-start: -40%; width: 42%; background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.12), transparent); animation: sheen 7.5s ease-in-out infinite; pointer-events: none; }
@keyframes sheen { 0% { transform: translateX(0); } 55% { transform: translateX(330%); } 100% { transform: translateX(330%); } }
.net-wrap { display: grid; gap: 14px; align-items: start; }
@media (min-width: 900px) { .net-wrap { grid-template-columns: 1.25fr 0.75fr; } }
.art-wide { margin-block-start: 16px; }
@media (min-width: 900px) { .art-wide { display: grid; grid-template-columns: 0.85fr 1.15fr; align-items: center; } .art-wide img { height: 100%; aspect-ratio: auto; } }

/* ─────────────────────────── pointer life ─────────────────────────── */
/*
 * A cursor-following highlight on the cards. It is two custom properties
 * written by one delegated pointermove listener, and one ::before that reads
 * them — no per-card listeners, no layout reads per frame beyond the bounding
 * box, and nothing at all under prefers-reduced-motion (initFx returns early
 * and the base state has opacity 0).
 */
.card, .net-card, .pulse-card, .stat-card, .say-card { position: relative; }
.card::before, .net-card::before, .pulse-card::before, .stat-card::before, .say-card::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: 0;
  background: radial-gradient(340px circle at var(--mx, 50%) var(--my, 50%), color-mix(in srgb, var(--ac, #8b5cf6) 22%, rgba(139, 92, 246, 0.14)), transparent 62%);
  transition: opacity 0.3s ease;
}
.card.is-lit::before, .net-card.is-lit::before, .pulse-card.is-lit::before, .stat-card.is-lit::before, .say-card.is-lit::before { opacity: 1; }
.card-sheen { position: absolute; inset-inline: 0; inset-block-end: 0; height: 1px; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--ac, #8b5cf6) 80%, transparent), transparent); opacity: 0.5; transform: scaleX(0.2); transition: transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.4s; }
.eco-card:hover .card-sheen { transform: scaleX(1); opacity: 1; }
.pulse-card { transform: translate3d(var(--px, 0px), var(--py, 0px), 0); }
.mini { transform: translate3d(var(--px, 0px), var(--py, 0px), 0); }

/* a number that just changed should say so, once */
@keyframes num-flash { 0% { background: rgba(78, 234, 255, 0.22); } 100% { background: transparent; } }
.num-flash { border-radius: 6px; animation: num-flash 1.1s ease; }

/*
 * The Intent chain reads as a sequence only if something travels through it.
 * One hairline above the grid draws itself from left to right (right to left in
 * RTL) as the steps below it light up — one custom property, no geometry
 * assumptions about whether the grid is one column or three.
 */
.flow-meter { display: block; height: 2px; margin-block-end: 10px; border-radius: 2px; overflow: hidden; background: rgba(160, 175, 230, 0.12); }
.flow-meter i { display: block; height: 100%; transform-origin: left center; transform: scaleX(var(--p, 0)); background: linear-gradient(90deg, #2dd4bf, #8b5cf6 60%, #f5c14e); transition: transform 0.7s cubic-bezier(0.22, 1, 0.36, 1); }
html[dir="rtl"] .flow-meter i { transform-origin: right center; }
html:not([data-js]) .flow-meter i { --p: 1; }
/* the tick that lands on the "you approve" step */
.flow-tick { font-style: normal; margin-inline-start: auto; color: var(--lime); font-size: 13px; }
.flow li.approve { box-shadow: inset 0 0 0 1px rgba(99, 245, 187, 0.14); }
.flow li.approve::after { content: ""; position: absolute; inset: -1px; border-radius: 16px; border: 1px solid rgba(99, 245, 187, 0.3); opacity: 0.5; animation: breathe 4.2s ease-in-out infinite; }
@keyframes breathe { 0%, 100% { opacity: 0.18; transform: scale(0.99); } 50% { opacity: 0.6; transform: scale(1.005); } }

/* reveal variants: direction and depth, chosen per block instead of one fade */
html[data-js] .reveal-l { opacity: 0; transform: translateX(-22px); transition: opacity 0.6s ease, transform 0.6s ease; }
html[data-js] .reveal-r { opacity: 0; transform: translateX(22px); transition: opacity 0.6s ease, transform 0.6s ease; }
html[data-js] .reveal-zoom { opacity: 0; transform: scale(0.96); transition: opacity 0.55s ease, transform 0.55s cubic-bezier(0.2, 0.9, 0.2, 1); }
html[data-js] :is(.reveal, .reveal-l, .reveal-r, .reveal-zoom).in { opacity: 1; transform: none; }
html[dir="rtl"][data-js] .reveal-l { transform: translateX(22px); }
html[dir="rtl"][data-js] .reveal-r { transform: translateX(-22px); }
.net-card:hover { box-shadow: 0 14px 30px -20px var(--nc, var(--violet)); }
.net-orb { transition: transform 0.3s ease; }
.net-card:hover .net-orb { transform: scale(1.14) rotate(-6deg); }

/* signals: photo panel + the honesty note, side by side from 900px */
.sig-split { display: grid; gap: 12px; margin-block-start: 18px; align-items: stretch; }
@media (min-width: 900px) { .sig-split { grid-template-columns: 1.1fr 0.9fr; } }
.sig-split .art-panel img { height: 100%; min-height: 240px; aspect-ratio: auto; object-fit: cover; }
.sig-split .note-inline { align-items: center; }

/* final CTA: the horizon photo, buried under the gradient so the type stays
   readable at 20:1 contrast while the image still gives the band depth */
.cta-band::before { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(180deg, rgba(8, 6, 24, 0.86), rgba(8, 6, 24, 0.62) 42%, rgba(8, 6, 24, 0.92)); }
.cta-art { position: absolute; inset: 0; z-index: -2; width: 100%; height: 100%; object-fit: cover; opacity: 0.85; animation: ken-burns 34s ease-in-out infinite alternate; }
.cta-band { isolation: isolate; }
.cta-band h2, .cta-band p, .cta-band .hero-actions { position: relative; }

/* ─────────────────────────── motion policy ─────────────────────────── */
/* reveal on scroll — base state is VISIBLE (no-JS crawlers see everything);
   only when the runtime marks html[data-js] do elements start hidden. */
html[data-js] .reveal { opacity: 0; transform: translateY(18px); transition: opacity 0.6s ease, transform 0.6s ease; transition-delay: var(--d, 0ms); }
html[data-js] .reveal.in { opacity: 1; transform: none; }

/* typewriter caret in hero console */
.tw { position: relative; }
.tw::after { content: "▌"; margin-inline-start: 2px; color: var(--cyan); animation: caret 1s steps(1) infinite; }
@keyframes caret { 50% { opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
  html[data-js] .reveal, html[data-js] :is(.reveal-l, .reveal-r, .reveal-zoom) { opacity: 1; transform: none; }
  .flow li { opacity: 1; transform: none; }
  /* Motion off means off: the line field, the tape, the ken-burns plate and
     the sheen are removed rather than frozen mid-animation. */
  .ambient { display: none; }
  .ai-tape-track { animation: none; overflow-x: auto; }
  .slide-plate img, .art-panel img { animation: none; transform: none; }
  .art-sheen, .beam { display: none; }
  .cta-art { animation: none; }
  .slide-lines { display: none; }
  /* with no autoplay the bar is meaningless — hide it, keep the dots */
  .show-progress { display: none; }
  .show-nav { opacity: 1; }
}
`;
