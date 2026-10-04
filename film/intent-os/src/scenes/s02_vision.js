/* SCENE 02 · 00:45–01:20 · THE FBT VISION
   A single blue line draws a network. The network becomes a wordmark. The
   wordmark becomes the product. Macro push-in, no aggression — the logo
   arrives because the network resolved into it, not because it animated in. */
import { TAU, clamp, lerp, inv, smooth, kf, rng, sprite, drawSprite, addBlend, camera, project, text, path as pth, dustField } from '../lib/fx.js';
import { nodeGraph, billboard } from '../lib/kit.js';
import { browserWindow, appNav, brandMark, el } from '../lib/ui.js';

const S = 2;

export default {
  id: 'sc02',
  title: 'The FBT Vision',
  t0: 45, t1: 80,

  build(env) {
    const root = document.createElement('div');
    root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';

    // wordmark
    const word = el('div', { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', display: 'flex', alignItems: 'center', gap: '26px', opacity: 0 });
    word.innerHTML = `<div class="display lg" style="letter-spacing:.02em">FBT</div>
      <div style="width:1px;height:64px;background:linear-gradient(180deg,transparent,rgba(120,180,255,.6),transparent)"></div>
      <div class="display lg" style="letter-spacing:.02em;color:#cfe2ff">SWAP</div>`;
    root.appendChild(word);

    const sub = el('div', { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,120px)', textAlign: 'center', opacity: 0 });
    sub.innerHTML = `<div class="kicker">FBT SWAP · INTENT OS</div>`;
    root.appendChild(sub);

    // the product window the logo becomes
    const win = browserWindow({ w: 1180, h: 720, x: 370, y: 200, url: 'fbtswap.ir' });
    win.root.style.opacity = 0;
    win.root.style.transformOrigin = '50% 50%';
    const nav = appNav({ active: 'Intent OS' });
    win.body.appendChild(nav);
    win.body.appendChild(intentTeaser());
    root.appendChild(win.root);

    // the closing lockup
    const lock = el('div', { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', opacity: 0 });
    lock.innerHTML = `
      <div class="display xl" style="letter-spacing:-.04em">INTENT<span style="color:#5cc9ff"> OS</span></div>
      <div class="kicker" style="margin-top:26px">AI-POWERED FINANCIAL OPERATING SYSTEM</div>
      <div class="mono" style="margin-top:44px;font-size:15px;letter-spacing:.3em;color:#5d6c8c">FBTSWAP.IR</div>`;
    root.appendChild(lock);

    env.scenesEl.appendChild(root);
    Object.assign(this, { root, word, sub, win, lock });
    return root;
  },

  frame(t, env) {
    const { back, front } = env;
    back.setTransform(S, 0, 0, S, 0, 0); back.clearRect(0, 0, 1920, 1080);
    front.setTransform(S, 0, 0, S, 0, 0); front.clearRect(0, 0, 1920, 1080);

    // ── 0–10s : the line draws a network ────────────────────────────────
    const drawK = smooth(inv(t, 0.4, 7.5));
    const r = rng(101);
    const nodes = [];
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * TAU + 0.4;
      const rad = 240 + r() * 420;
      nodes.push({ x: Math.cos(a) * rad * 1.5, y: Math.sin(a) * rad * 0.62, z: (r() - 0.5) * 260, r: 8 + r() * 10, label: null });
    }
    nodes.unshift({ x: 0, y: 0, z: 0, r: 34, hot: true, label: null });
    const links = [];
    for (let i = 1; i < nodes.length; i++) links.push([0, i]);
    for (let i = 1; i < nodes.length; i++) links.push([i, i + 1 < nodes.length ? i + 1 : 1]);

    const cam = camera({ px: kf(t, [[0, 0], [8, 0], [16, -40], [26, 0], [35, 0]]), py: 0, pz: kf(t, [[0, 2100], [7, 1300], [14, 700], [22, 200], [30, -260]]), yaw: kf(t, [[0, 0], [10, 0.06], [18, -0.04], [30, 0.02]]), fov: kf(t, [[0, 40], [12, 34], [24, 30], [35, 28]]) });

    // Only draw the graph while it is still the subject; the DOM wordmark
    // and the window take over from t≈7.
    const graphAlpha = (1 - smooth(inv(t, 8.5, 12))) * clamp(inv(t, 0.2, 1.2));
    if (graphAlpha > 0.01) {
      back.save();
      back.globalAlpha = graphAlpha;
      // the line that draws itself
      const drawn = nodes.slice(0, Math.max(2, Math.ceil(drawK * nodes.length)));
      nodeGraph(back, cam, t, drawn, links.filter(([a, b]) => a < drawn.length && b < drawn.length), { alpha: graphAlpha, label: false });
      back.restore();
      // travelling head of the drawing line
      if (drawK < 1) {
        const i = Math.max(1, Math.ceil(drawK * nodes.length) - 1);
        const p = project(cam, nodes[i]);
        if (p) { addBlend(back, true); drawSprite(back, sprite('rgba(220,240,255,1)', 0.4), p.x, p.y, 120 * clamp(p.s * 300, .4, 2), 0.8); addBlend(back, false); }
      }
    }
    dustField(back, cam, t, { count: 90, seed: 3, spread: 900, focus: 900, color: 'rgba(140,190,255,1)' });

    // ── camera push-in on the wordmark ──────────────────────────────────
    const wordK = smooth(inv(t, 6.5, 9.4));
    const worldScale = kf(t, [[6, 1], [14, 1.02], [18, 1.16], [22, 1.5], [26, 2.2]]);
    this.word.style.opacity = wordK * (1 - smooth(inv(t, 12.5, 15)));
    this.word.style.transform = `translate(-50%,-50%) scale(${1 + 1.1 * wordK})`;
    this.word.style.filter = `blur(${(1 - wordK) * 8}px)`;
    this.sub.style.opacity = smooth(inv(t, 9.6, 11.4)) * (1 - smooth(inv(t, 13.5, 15.5)));
    this.sub.style.transform = 'translate(-50%,120px)';

    // ── the wordmark becomes the interface ──────────────────────────────
    const winK = smooth(inv(t, 13.8, 17.4));
    this.win.root.style.opacity = winK;
    const wscale = lerp(0.92, 1.06 + 0.9 * smooth(inv(t, 20, 26)), winK);
    this.win.root.style.transform = `scale(${wscale})`;
    this.win.root.style.filter = `blur(${(1 - winK) * 6}px)`;
    void worldScale;

    // ── zoom into INTENT OS ─────────────────────────────────────────────
    const zoomK = smooth(inv(t, 24, 29));
    const navItem = this.win.body.querySelector('.nav-item.on');
    if (navItem) {
      navItem.style.boxShadow = `0 0 0 1px rgba(77,155,255,${0.36 + 0.4 * zoomK}) inset, 0 0 ${30 * zoomK}px rgba(47,125,255,${0.35 * zoomK})`;
    }
    const lockK = smooth(inv(t, 26.5, 29.6));
    this.lock.style.opacity = lockK;
    this.lock.style.transform = `translate(-50%,-50%) scale(${lerp(1.14, 1, lockK)})`;
    // the window recedes into the distance as the lockup takes the frame
    this.win.root.style.opacity = winK * (1 - smooth(inv(t, 26.5, 29))) * 0.85;

    front.save();
    front.globalAlpha = 0.35 * zoomK * (1 - smooth(inv(t, 33, 35)));
    const g = front.createRadialGradient(960 * S, 540 * S, 0, 960 * S, 540 * S, 760 * S);
    g.addColorStop(0, 'rgba(90,150,255,0.30)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    front.fillStyle = g;
    front.fillRect(0, 0, 1920 * S, 1080 * S);
    front.restore();
  }
};

/* a quiet product still shown inside the window at 00:55 — real panels, not
   a screenshot of a marketing page */
function intentTeaser() {
  const body = el('div', { position: 'absolute', inset: 0, padding: '34px 40px', display: 'flex', flexDirection: 'column', gap: '18px' });
  body.innerHTML = `
    <div class="kicker">FBT INTENT OS</div>
    <div class="display sm" style="max-width:640px">WHAT WOULD YOU LIKE TO ACHIEVE?</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div class="chip sel"><span class="dot"></span>Grow my portfolio</div>
      <div class="chip"><span class="dot"></span>Protect capital</div>
      <div class="chip"><span class="dot"></span>Generate yield</div>
      <div class="chip"><span class="dot"></span>Analyze an asset</div>
    </div>`;
  const grid = el('div', { display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '18px', flex: 1 });
  const q = el('div', 'card');
  q.style.padding = '22px';
  q.innerHTML = `<div class="label">DESCRIBE YOUR GOAL</div>
    <div style="font-size:19px;color:#93a3c4;margin-top:14px">I want to grow my portfolio over the next three years…</div>
    <div style="margin-top:auto;padding-top:26px" class="tiny">Intent OS structures the request, then shows exactly what it will do — and asks before anything is signed.</div>`;
  const p = el('div', 'card flat');
  p.style.padding = '22px';
  p.innerHTML = `<div class="label">RECENT INTENTS</div>
    <div style="margin-top:16px;display:flex;flex-direction:column;gap:14px">
      ${['Rebalance · moderate drift', 'Yield · USDC 6.4% target', 'Analyze ETH · risk review'].map((s) => `<div style="display:flex;align-items:center;gap:10px;font-size:14px;color:#93a3c4"><span style="width:6px;height:6px;border-radius:50%;background:#4d9bff"></span>${s}</div>`).join('')}
    </div>`;
  grid.appendChild(q); grid.appendChild(p);
  body.appendChild(grid);
  return body;
}
