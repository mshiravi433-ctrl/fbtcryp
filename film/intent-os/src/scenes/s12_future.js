/* SCENE 12 · 09:10–09:40 · THE FUTURE OF FINANCIAL INTERACTION
   The camera leaves the interface and finds it again — small, at the centre
   of a connected world: AI, markets, blockchains, wallets, liquidity, people.
   The claim is modest on purpose: easier to understand, not more screens. */
import { room, clamp, inv, smooth, kf, lerp, camera, dustField, sprite, drawSprite, addBlend, project, text, TAU, rng } from '../lib/fx.js';
import { nodeGraph, billboard } from '../lib/kit.js';
import { el, brandMark } from '../lib/ui.js';

const HUBS = [
  ['AI', '#7cbaff'], ['MARKETS', '#5cc9ff'], ['BLOCKCHAIN', '#9a86ff'], ['WALLETS', '#4d9bff'],
  ['DATA', '#7cbaff'], ['LIQUIDITY', '#46d9a8'], ['ASSETS', '#5cc9ff'], ['USERS', '#9a86ff']
];

export default {
  id: 'sc12',
  title: 'The Future of Financial Interaction',
  t0: 550, t1: 580,

  build(env) {
    const root = el('div', { position: 'absolute', inset: '0', overflow: 'hidden' });
    const world = el('div', { position: 'absolute', inset: '0' });
    root.appendChild(world);

    // the interface, seen from very far away
    const panel = el('div', 'card');
    panel.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:520px;padding:22px;box-shadow:0 0 90px rgba(47,125,255,.35), 0 30px 80px rgba(0,0,0,.7)';
    panel.innerHTML = `<div style="display:flex;align-items:center;gap:10px">${brandMark(18).outerHTML}
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.24em;color:#93a3c4">INTENT OS</div></div>
      <div style="font-size:19px;margin-top:14px;color:#e8eeff">One intent. One intelligent workflow.</div>
      <div style="margin-top:14px;height:6px;border-radius:3px;background:rgba(255,255,255,.07);overflow:hidden"><i style="display:block;height:100%;width:64%;background:linear-gradient(90deg,#2f7dff,#5cc9ff)"></i></div>`;
    world.appendChild(panel);
    this.panel = panel;

    const cap = el('div', { position: 'absolute', left: '0', right: '0', bottom: '72px', textAlign: 'center', opacity: '0' });
    cap.innerHTML = `<div class="lead" style="font-size:24px;max-width:900px;margin:0 auto">It may not be about adding more screens.
      <strong>It may be about making complex systems easier to understand.</strong></div>`;
    world.appendChild(cap);
    this.cap = cap;

    env.scenesEl.appendChild(root);
    Object.assign(this, { root, world });
    return root;
  },

  frame(t, env) {
    const { back, front } = env;
    back.setTransform(2, 0, 0, 2, 0, 0); back.clearRect(0, 0, 1920, 1080);
    room(back, { t, key: 'rgba(26,58,124,0.5)', keyY: 0.46, keyR: 1.2 });
    front.setTransform(2, 0, 0, 2, 0, 0); front.clearRect(0, 0, 1920, 1080);

    // pull back: the interface shrinks into the network
    const pullK = smooth(inv(t, 0.6, 13));
    const panelScale = lerp(1.05, 0.30, pullK);
    this.panel.style.transform = `translate(-50%,-50%) scale(${panelScale})`;
    this.panel.style.opacity = String(1 - 0.45 * smooth(inv(t, 16, 26)));

    // the world grows around it
    // a pure optical pull-back: the lens widens, the camera barely moves, so
    // the interface stays the subject while the network grows around it.
    const cam = camera({
      px: 0, py: 0,
      pz: kf(t, [[0, -1500], [14, -1450], [30, -1400]]),
      yaw: kf(t, [[0, 0], [12, 0.06], [30, 0.16]]), fov: kf(t, [[0, 30], [10, 40], [20, 50], [30, 56]])
    });

    const revealK = smooth(inv(t, 1.0, 7.5));
    if (revealK > 0.01) {
      const nodes = [{ x: 0, y: 0, z: 0, r: 40, hot: true, label: null }];
      HUBS.forEach(([label, color], i) => {
        const a = (i / HUBS.length) * TAU + 0.3;
        const rad = 780 + (i % 3) * 160;
        nodes.push({
          x: Math.cos(a) * rad, y: Math.sin(a) * rad * 0.34, z: Math.sin(a * 1.6) * 420,
          r: 20, label, hot: false
        });
      });
      const links = HUBS.map((_, i) => [0, i + 1]).concat(HUBS.map((_, i) => [i + 1, ((i + 1) % HUBS.length) + 1]));
      back.save();
      back.globalAlpha = Math.min(0.95, revealK * 1.05);
      nodeGraph(back, cam, t, nodes, links, { alpha: revealK, label: true });
      back.restore();

      // arcs of light between hubs — the connections themselves
      back.save();
      back.globalAlpha = revealK * 0.26;
      addBlend(back, true);
      const r = rng(151);
      for (let i = 0; i < 60; i++) {
        const a = r() * TAU, b = a + 0.4 + r() * 1.6;
        const R1 = 700 + r() * 400, R2 = 700 + r() * 400;
        const p0 = project(cam, { x: Math.cos(a) * R1, y: Math.sin(a) * R1 * 0.34, z: Math.sin(a * 1.6) * 420 });
        const p1 = project(cam, { x: Math.cos(b) * R2, y: Math.sin(b) * R2 * 0.34, z: Math.sin(b * 1.6) * 420 });
        if (!p0 || !p1) continue;
        back.strokeStyle = 'rgba(120,180,255,0.7)';
        back.lineWidth = 1;
        back.beginPath();
        back.moveTo(p0.x, p0.y);
        const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2 - 60;
        back.quadraticCurveTo(mx, my, p1.x, p1.y);
        back.stroke();
      }
      addBlend(back, false);
      back.restore();
      dustField(back, cam, t, { count: 220, seed: 161, spread: 2400, focus: 1600, color: 'rgba(150,200,255,1)' });
    }

    const capK = smooth(inv(t, 14.5, 17.5));
    this.cap.style.opacity = String(capK * (1 - smooth(inv(t, 28, 30))));
    void front; void billboard; void text; void kf; void clamp; void drawSprite; void sprite;
  }
};
