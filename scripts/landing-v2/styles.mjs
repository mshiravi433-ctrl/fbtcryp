/**
 * LANDING 2.0 — DESIGN SYSTEM (hand-rolled, zero dependencies).
 * ---------------------------------------------------------------------------
 * Mobile-first, dark-futuristic, glassmorphism. Every layout rule uses CSS
 * logical properties so the SAME stylesheet renders both LTR and RTL — the
 * only thing that flips is `dir` on <html>.
 *
 * Second-language switching is pure CSS: each bilingual string is rendered
 * twice (`span.lg-en`/`span.lg-fa`) at build time and the root's data-lang
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
.ambient { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
.ambient-grid {
  position: absolute; inset: -20% -10%;
  background-image:
    linear-gradient(rgba(139, 92, 246, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(139, 92, 246, 0.07) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(72% 55% at 50% 0%, #000 0%, transparent 92%);
}
.orb { position: absolute; border-radius: 50%; filter: blur(90px); opacity: 0.5; }
.orb-a { width: 44vw; height: 44vw; max-width: 640px; max-height: 640px; inset-block-start: -16%; inset-inline-end: -10%; background: radial-gradient(circle, rgba(124, 58, 237, 0.5), transparent 62%); animation: orb-drift 26s ease-in-out infinite alternate; }
.orb-b { width: 36vw; height: 36vw; max-width: 520px; max-height: 520px; inset-block-start: 34%; inset-inline-start: -14%; background: radial-gradient(circle, rgba(78, 234, 255, 0.22), transparent 62%); animation: orb-drift 32s ease-in-out infinite alternate-reverse; }
@keyframes orb-drift { from { transform: translate3d(0, 0, 0) scale(1); } to { transform: translate3d(4vw, 6vh, 0) scale(1.12); } }

/* ─────────────────────────── layout ─────────────────────────── */
.wrap { width: min(1180px, 100% - 32px); margin-inline: auto; }
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
  transition: background 0.25s ease, border-color 0.25s ease, backdrop-filter 0.25s ease;
}
.nav.scrolled {
  background: rgba(7, 5, 20, 0.72);
  border-block-end-color: var(--line);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.nav-inner { display: flex; align-items: center; gap: 14px; padding-block: 12px; }
.brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 800; font-size: 17px; text-decoration: none; letter-spacing: -0.01em; }
.brand-mark {
  display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.35), rgba(78, 234, 255, 0.2));
  border: 1px solid rgba(139, 92, 246, 0.4);
  box-shadow: var(--glow-violet);
}
.brand-mark img { border-radius: 8px; }
.nav-links { display: none; align-items: center; gap: 4px; margin-inline-start: 10px; }
.nav-links a {
  padding: 7px 11px; border-radius: 10px; color: var(--muted); font-size: 13.5px; font-weight: 600;
  text-decoration: none; transition: color 0.2s, background 0.2s;
}
.nav-links a:hover { color: var(--ink); background: rgba(139, 92, 246, 0.14); }
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
.nav-cta { display: none; }
.menu-toggle { display: inline-grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; border: 1px solid var(--line); background: rgba(12, 9, 30, 0.6); color: var(--ink); cursor: pointer; }
.menu-toggle svg { width: 18px; height: 18px; }
.mobile-menu { display: none; border-block-end: 1px solid var(--line); background: rgba(7, 5, 20, 0.94); backdrop-filter: blur(18px); }
.mobile-menu.open { display: block; }
.mobile-menu a { display: block; padding: 13px 6px; color: var(--muted); font-weight: 650; font-size: 15px; text-decoration: none; border-block-start: 1px solid rgba(160, 175, 230, 0.07); }
.mobile-menu a:first-child { border-block-start: 0; }
@media (min-width: 900px) {
  .nav-links { display: inline-flex; }
  .nav-cta { display: inline-flex; }
  .menu-toggle { display: none; }
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
.card-icon {
  display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 38px;
  border-radius: 12px; border: 1px solid rgba(139, 92, 246, 0.35);
  background: linear-gradient(140deg, rgba(124, 58, 237, 0.22), rgba(78, 234, 255, 0.1));
  color: #c3b3ff;
}
.card-icon svg { width: 19px; height: 19px; }
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
footer.site { margin-block-start: 30px; border-block-start: 1px solid var(--line); padding: clamp(30px, 4vw, 48px) 0 90px; }
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
  html[data-js] .reveal { opacity: 1; transform: none; }
  .flow li { opacity: 1; transform: none; }
}
`;
