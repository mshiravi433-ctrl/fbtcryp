/* ==========================================================================
   film.js — the director
   --------------------------------------------------------------------------
   The film is a pure function of time: `seek(t)` renders the exact frame for
   second t, and rendering the same t twice produces the same pixels. The
   offline renderer walks t = 0 → 600 at 1/24s and never talks to the scenes
   directly; it only calls seek(). That is what makes a 14,400-frame render
   restartable, inspectable and honest.
   ========================================================================== */
import s01 from './scenes/s01_complexity.js';
import s02 from './scenes/s02_vision.js';
import s03 from './scenes/s03_open.js';
import s04 from './scenes/s04_intent.js';
import s05 from './scenes/s05_context.js';
import s06 from './scenes/s06_plan.js';
import s07 from './scenes/s07_network.js';
import s08 from './scenes/s08_control.js';
import s09 from './scenes/s09_execution.js';
import s10 from './scenes/s10_monitoring.js';
import s11 from './scenes/s11_loop.js';
import s12 from './scenes/s12_future.js';
import s13 from './scenes/s13_brand.js';
import { rng } from './lib/fx.js';

export const SCENES = [s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11, s12, s13];
export const FPS = 24;
export const DURATION = SCENES[SCENES.length - 1].t1; // 600s

const stage = document.getElementById('stage');
const scenesEl = document.getElementById('scenes');
const back = document.getElementById('fx-back');
const front = document.getElementById('fx-front');
const grainEl = document.getElementById('grain');
const fadeEl = document.getElementById('fade');

const backCtx = back.getContext('2d', { alpha: true });
const frontCtx = front.getContext('2d', { alpha: true });

const env = { back: backCtx, front: frontCtx, scenesEl, stage, W: 1920, H: 1080 };

/* deterministic film grain — generated once, identical for every render */
function makeGrain() {
  const size = 340;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  const r = rng(20261004);
  for (let i = 0; i < size * size; i++) {
    const v = 120 + Math.floor(r() * 140);
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/* ── build once ───────────────────────────────────────────────────────── */
for (const scene of SCENES) {
  scene.node = scene.build(env);
  scene.node.style.display = 'none';
  scene.node.style.opacity = '1';
}

/* ── stage scaling for on-screen preview ─────────────────────────────── */
function fit() {
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.transform = `scale(${s})`;
}
window.addEventListener('resize', fit);
fit();

/* ── the only public entry point ─────────────────────────────────────── */
let active = null;
function seek(t) {
  const time = Math.max(0, Math.min(DURATION - 1e-6, t));
  const scene = SCENES.find((s) => time >= s.t0 && time < s.t1) || SCENES[SCENES.length - 1];
  if (scene !== active) {
    if (active) active.node.style.display = 'none';
    scene.node.style.display = 'block';
    active = scene;
  }
  scene.frame(time - scene.t0, env);
  // the film's two global states: nothing at the head, black at the tail
  fadeEl.style.opacity = String(Math.max(0, (time - 596) / 4));
  return { scene: scene.id, title: scene.title, local: time - scene.t0 };
}

window.__film = {
  duration: DURATION,
  fps: FPS,
  seek,
  scenes: SCENES.map((s) => ({ id: s.id, title: s.title, t0: s.t0, t1: s.t1 }))
};

/* ready flag for the renderer: fonts loaded, grain built, first frame drawn */
(async function boot() {
  const params0 = new URLSearchParams(location.search);
  // ?lite=1 drops the full-screen finishing layers for the offline renderer:
  // in a software rasteriser each blended layer costs a full 4K composite.
  if (params0.get('lite') === '1') {
    for (const id of ['grain', 'bloom', 'vignette']) {
      const n = document.getElementById(id); if (n) n.style.display = 'none';
    }
  } else {
    grainEl.style.backgroundImage = `url(${makeGrain()})`;
  }
  try { await document.fonts.ready; } catch { /* older engines */ }
  // force one synchronous layout so nothing pops on frame 1
  void stage.offsetHeight;
  seek(0);

  const params = new URLSearchParams(location.search);
  if (params.has('t')) seek(Number(params.get('t')));
  window.__filmReady = true;
})();
