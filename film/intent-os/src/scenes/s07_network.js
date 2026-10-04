/* SCENE 07 · 04:50–05:50 · CONNECTING FBT INTELLIGENCE
   Intent OS sits at the centre of the product's capabilities. The camera
   travels between modules, and each one contributes a perspective — never a
   verdict. MULTI-LAYER ANALYSIS, not multi-layer certainty. */
import { el, brandLockup, MODULES, moduleNode } from '../lib/ui.js';
import { clamp, inv, smooth, kf, lerp, camera, dustField, sprite, drawSprite, addBlend, project, TAU, room } from '../lib/fx.js';
import { nodeGraph } from '../lib/kit.js';

const CHAIN = [
  ['MARKET DATA', 'Prices, depth, funding and volatility across venues'],
  ['SIGNAL', 'Technical context — trend, momentum, positioning'],
  ['SMART MONEY', 'On-chain flows and wallet behaviour'],
  ['RISK', 'Volatility bands, drawdown and exposure limits'],
  ['PORTFOLIO CONTEXT', 'How this asset sits next to everything else you hold'],
  ['ANALYSIS', 'A combined read — with its assumptions stated']
];

export default {
  id: 'sc07',
  title: 'Connecting FBT Intelligence',
  t0: 290, t1: 350,

  build(env) {
    const root = el('div', { position: 'absolute', inset: '0', overflow: 'hidden' });
    
    const world = el('div', { position: 'absolute', inset: '0' });
    root.appendChild(world);

    const top = el('div', { position: 'absolute', top: '0', left: '0', right: '0', height: '74px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 46px', borderBottom: '1px solid rgba(255,255,255,.06)', background: 'rgba(6,10,18,.7)' });
    top.appendChild(brandLockup(22, { sub: 'CAPABILITY MAP' }));
    const hb = el('div', { display: 'flex', gap: '12px' });
    hb.appendChild(el('div', 'badge blue', '<span class="led"></span>10 MODULES'));
    hb.appendChild(el('div', 'badge', 'COORDINATION LAYER'));
    top.appendChild(hb);
    world.appendChild(top);

    // module ring
    const ring = el('div', { position: 'absolute', left: '50%', top: '52%', transform: 'translate(-50%,-50%)', width: '1600px', height: '800px' });
    const cx = 800, cy = 400, RX = 620, RY = 300;
    const nodes = [];
    MODULES.forEach((m, i) => {
      const a = (i / MODULES.length) * TAU - Math.PI / 2;
      const n = moduleNode(m);
      n.style.position = 'absolute';
      n.style.left = (cx + Math.cos(a) * RX - 98) + 'px';
      n.style.top = (cy + Math.sin(a) * RY - 30) + 'px';
      n.style.opacity = '0';
      n.style.transition = 'none';
      ring.appendChild(n);
      nodes.push(n);
    });

    // links between the centre and every module
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '1600'); svg.setAttribute('height', '800');
    svg.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    nodes.forEach((_, i) => {
      const a = (i / MODULES.length) * TAU - Math.PI / 2;
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', cx); l.setAttribute('y1', cy);
      l.setAttribute('x2', cx + Math.cos(a) * RX); l.setAttribute('y2', cy + Math.sin(a) * RY);
      l.setAttribute('stroke', 'rgba(80,140,240,.28)');
      l.setAttribute('stroke-width', '1');
      l.dataset.link = String(i);
      svg.appendChild(l);
    });
    ring.insertBefore(svg, ring.firstChild);

    // centre
    const centre = el('div', 'card active');
    centre.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:20px 26px;text-align:center;opacity:0';
    centre.innerHTML = `<div style="font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.28em;color:#7cbaff">INTENT OS</div>
      <div style="font-size:14px;color:#93a3c4;margin-top:8px">coordinating capabilities</div>`;
    ring.appendChild(centre);
    world.appendChild(ring);
    this.ring = ring; this.nodes = nodes; this.centre = centre; this.svg = svg;

    // the ask
    const chat = el('div', 'card');
    chat.style.cssText = 'position:absolute;left:46px;bottom:44px;width:620px;padding:20px 22px;opacity:0';
    chat.innerHTML = `<div class="label">YOU ASK</div>
      <div data-q style="font-size:20px;margin-top:10px;line-height:1.45"></div>
      <div class="row between" style="margin-top:14px">
        <div class="tiny">Analysis is a perspective, not a prediction.</div>
        <div class="badge blue" data-run>RUNNING</div>
      </div>`;
    world.appendChild(chat);
    this.chat = chat;

    // the chain readout
    const chain = el('div', 'card flat');
    chain.style.cssText = 'position:absolute;right:46px;bottom:44px;width:560px;padding:20px 22px;opacity:0';
    chain.innerHTML = `<div class="label">ANALYSIS PIPELINE</div><div data-list style="margin-top:12px"></div>`;
    world.appendChild(chain);
    this.chain = chain;
    this.chainRows = CHAIN.map(([k, d]) => {
      const r = el('div', { display: 'flex', gap: '12px', padding: '8px 0', opacity: '0' });
      r.innerHTML = `<span data-lamp style="width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.14);margin-top:6px;flex:0 0 auto"></span>
        <div><div style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.16em;color:#93a3c4">${k}</div>
        <div style="font-size:12px;color:#5d6c8c;margin-top:3px">${d}</div></div>`;
      chain.querySelector('[data-list]').appendChild(r);
      return r;
    });

    const cap = el('div', { position: 'absolute', left: '0', right: '0', top: '112px', textAlign: 'center', opacity: '0' });
    cap.innerHTML = `<div class="kicker" style="letter-spacing:.4em">MULTI-LAYER ANALYSIS</div>`;
    world.appendChild(cap);
    this.cap = cap;

    env.scenesEl.appendChild(root);
    Object.assign(this, { root, world, chatText: chat.querySelector('[data-q]'), runBadge: chat.querySelector('[data-run]') });
    return root;
  },

  frame(t, env) {
    const { back, front } = env;
    back.setTransform(2, 0, 0, 2, 0, 0); back.clearRect(0, 0, 1920, 1080);
    room(back, { t, key: 'rgba(30,66,132,0.58)', keyY: 0.42, keyR: 1.15 });
    front.setTransform(2, 0, 0, 2, 0, 0); front.clearRect(0, 0, 1920, 1080);

    // the ring camera: wide → into a module → back out. Each move is a
    // narrative step through the analysis pipeline.
    const fly = flyPath(t);
    this.ring.style.transform = `translate(-50%,-50%) translate(${fly.x}px, ${fly.y}px) scale(${fly.s})`;

    // module entrance
    this.nodes.forEach((n, i) => {
      const k = smooth(inv(t, 0.6 + i * 0.16, 1.6 + i * 0.16));
      n.style.opacity = String(k * 0.96);
      n.style.transform = `translateY(${(1 - k) * 18}px)`;
    });
    this.centre.style.opacity = String(smooth(inv(t, 0.2, 1.0)));
    this.centre.dataset.k = '1';

    // ── the question ───────────────────────────────────────────────────
    const Q = 'Analyze ETH before I make a decision.';
    const typeK = clamp((t - 6.4) * 15);
    this.chatText.textContent = Q.slice(0, Math.floor(typeK)) + (typeK < Q.length ? '▌' : '');
    this.chat.style.opacity = String(smooth(inv(t, 5.4, 6.4)));
    this.chat.style.transform = `translateY(${(1 - smooth(inv(t, 5.4, 6.4))) * 20}px)`;

    // ── the pipeline lights up in step with the camera ─────────────────
    const startStep = 12.5, stepLen = 4.2;
    this.chainRows.forEach((r, i) => {
      const lit = smooth(inv(t, startStep + i * (stepLen * 0.55), startStep + 1.2 + i * (stepLen * 0.55)));
      r.style.opacity = String(lit);
      const lamp = r.querySelector('[data-lamp]');
      const on = lit > 0.6;
      lamp.style.background = on ? (i === CHAIN.length - 1 ? '#46d9a8' : '#4d9bff') : 'rgba(255,255,255,.14)';
      lamp.style.boxShadow = on ? `0 0 12px ${i === CHAIN.length - 1 ? '#46d9a8' : '#4d9bff'}` : 'none';
    });
    this.chain.style.opacity = String(smooth(inv(t, 11.6, 12.8)));
    this.runBadge.textContent = t > 32 ? 'COMPLETE · 6 LAYERS' : 'RUNNING';
    this.runBadge.className = 'badge ' + (t > 32 ? 'mint' : 'blue');

    // active module highlight follows the camera
    const active = fly.focus;
    this.nodes.forEach((n, i) => {
      const on = i === active;
      n.style.borderColor = on ? 'rgba(90,165,255,.65)' : '';
      n.style.boxShadow = on ? '0 0 50px rgba(47,125,255,.28), 0 24px 70px rgba(0,0,0,.62)' : '';
      n.style.background = on ? 'linear-gradient(168deg, rgba(22,38,68,.98), rgba(9,14,26,.98))' : '';
    });
    [...this.svg.querySelectorAll('line')].forEach((l, i) => {
      const on = i === active;
      l.setAttribute('stroke', on ? 'rgba(120,180,255,.75)' : 'rgba(80,140,240,.22)');
      l.setAttribute('stroke-width', on ? '1.6' : '1');
    });

    // ── the canvas reads as the space between the modules ──────────────
    const cam = camera({ px: fly.x * 1.7, py: -fly.y * 1.7, pz: -700 / fly.s + 200, yaw: fly.yaw, fov: 44 });
    back.save();
    back.globalAlpha = 0.75;
    const gnodes = MODULES.map((m, i) => {
      const a = (i / MODULES.length) * TAU - Math.PI / 2;
      return { x: Math.cos(a) * 900, y: Math.sin(a) * 440, z: Math.sin(a * 2) * 220, r: 16, label: null, hot: i === active };
    });
    const glinks = gnodes.map((_, i) => [i, (i + 1) % gnodes.length]);
    nodeGraph(back, cam, t, [...gnodes, { x: 0, y: 0, z: 0, r: 34, hot: true }], [...glinks, ...gnodes.map((_, i) => [i, gnodes.length])], { alpha: 0.5, label: false });
    dustField(back, cam, t, { count: 150, seed: 41, spread: 1600, focus: 1200, color: 'rgba(150,200,255,1)' });
    back.restore();

    this.cap.style.opacity = String(smooth(inv(t, 30, 32.4)));
    void sprite; void drawSprite; void addBlend; void project; void kf; void lerp; void camera;
  }
};

/**
 * The camera move list for this scene. Returns focus index (module) and the
 * transform applied to the module ring, so the DOM and the canvas agree.
 */
function flyPath(t) {
  const moves = [
    { t: 0, focus: -1, x: 0, y: 0, s: 1, yaw: 0 },
    { t: 12.5, focus: 0, x: 420, y: 210, s: 1.28, yaw: 0.12 },  // MARKET
    { t: 16.7, focus: 1, x: 560, y: -230, s: 1.35, yaw: -0.16 }, // SIGNAL
    { t: 20.9, focus: 2, x: -520, y: -230, s: 1.35, yaw: 0.2 },  // SMART MONEY
    { t: 25.1, focus: 3, x: -560, y: 210, s: 1.32, yaw: -0.1 },  // WALLET/RISK
    { t: 29.3, focus: 4, x: 0, y: 330, s: 1.3, yaw: 0.05 },      // SWAP/PORTFOLIO
    { t: 33.5, focus: -1, x: 0, y: 0, s: 1.02, yaw: 0 }
  ];
  let a = moves[0], b = moves[1];
  for (let i = 0; i < moves.length - 1; i++) {
    if (t >= moves[i].t && t <= moves[i + 1].t) { a = moves[i]; b = moves[i + 1]; break; }
    if (t > moves[moves.length - 1].t) { a = b = moves[moves.length - 1]; }
  }
  const k = b.t === a.t ? 1 : smooth((t - a.t) / (b.t - a.t));
  // for the focus, switch at the midpoint so the highlight lands with the cut
  const focus = k < 0.5 ? a.focus : b.focus;
  return {
    focus,
    x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k),
    s: lerp(a.s, b.s, k), yaw: lerp(a.yaw, b.yaw, k)
  };
}
