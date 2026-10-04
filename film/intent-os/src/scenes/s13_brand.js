/* SCENE 13 · 09:40–10:00 · FINAL BRAND REVEAL
   Black. One blue line draws the mark. Then the name, the promise in four
   verbs, and the address. A single light sweep, and out. */
import { el } from '../lib/ui.js';
import { room, clamp, inv, smooth, kf, lerp, dustField, camera, sprite, drawSprite, addBlend } from '../lib/fx.js';

export default {
  id: 'sc13',
  title: 'Final Brand Reveal',
  t0: 580, t1: 600,

  build(env) {
    const root = el('div', { position: 'absolute', inset: '0', overflow: 'hidden' });
    const world = el('div', { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center' });
    root.appendChild(world);

    const stack = el('div', { position: 'relative', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' });

    // the mark, drawn as strokes
    const markWrap = el('div', { position: 'relative', width: '156px', height: '156px', marginBottom: '34px' });
    markWrap.innerHTML = `
      <svg width="156" height="156" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <defs>
          <linearGradient id="bgrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#5cc9ff"/><stop offset="52%" stop-color="#7a5cff"/><stop offset="100%" stop-color="#2f7dff"/>
          </linearGradient>
        </defs>
        <g stroke="url(#bgrad)" stroke-width="1.5">
          <circle id="s1" cx="12" cy="12" r="9.2"/>
          <path id="s2" d="M8.4 10.6a3.8 3.8 0 0 1 6.5-1.4"/>
          <path id="s3" d="M15.6 13.4a3.8 3.8 0 0 1-6.5 1.4"/>
          <path id="s4" d="M14.6 6.6v2.9h-2.9"/>
          <path id="s5" d="M9.4 17.4v-2.9h2.9"/>
        </g>
      </svg>`;
    stack.appendChild(markWrap);
    this.markWrap = markWrap;
    this.strokes = ['s1', 's2', 's3', 's4', 's5'].map((id) => markWrap.querySelector('#' + id));
    this.strokes.forEach((s, i) => {
      let len = 0;
      try { len = s.getTotalLength(); } catch { len = 0; }
      s.style.strokeDasharray = String(len);
      s.style.strokeDashoffset = String(len);
      s.dataset.len = String(len);
    });

    world.appendChild(stack); // attached before measuring strokes: getTotalLength() rejects detached geometry

    const name = el('div', { opacity: '0' });
    name.innerHTML = `<div class="display lg" style="letter-spacing:.02em">FBT <span style="color:#cfe2ff">SWAP</span></div>`;
    stack.appendChild(name);
    this.name = name;

    const os = el('div', { marginTop: '18px', opacity: '0' });
    os.innerHTML = `<div class="kicker" style="letter-spacing:.46em;color:#7cbaff">INTENT OS</div>`;
    stack.appendChild(os);
    this.os = os;

    const promise = el('div', { marginTop: '40px', opacity: '0' });
    promise.innerHTML = `<div style="font-size:24px;letter-spacing:.18em;color:#e8eeff;font-weight:500">UNDERSTAND.&nbsp; PLAN.&nbsp; VERIFY.&nbsp; ACT.</div>`;
    stack.appendChild(promise);
    this.promise = promise;

    const url = el('div', { marginTop: '54px', opacity: '0' });
    url.innerHTML = `<div class="mono" style="font-size:16px;letter-spacing:.34em;color:#93a3c4">FBTSWAP.IR</div>`;
    stack.appendChild(url);
    this.url = url;

    // the sweep that crosses the mark
    const sweep = el('div', { position: 'absolute', top: '0', left: '-160px', width: '120px', height: '156px', background: 'linear-gradient(100deg, transparent, rgba(190,225,255,.75), transparent)', filter: 'blur(6px)', opacity: '0', mixBlendMode: 'screen' });
    markWrap.appendChild(sweep);
    this.sweep = sweep;

    env.scenesEl.appendChild(root);
    Object.assign(this, { root, world, stack });
    return root;
  },

  frame(t, env) {
    const { back, front } = env;
    back.setTransform(2, 0, 0, 2, 0, 0); back.clearRect(0, 0, 1920, 1080);
    room(back, { t, key: 'rgba(28,62,132,0.5)', keyY: 0.46, keyR: 0.72, breathe: 0.02 });
    front.setTransform(2, 0, 0, 2, 0, 0); front.clearRect(0, 0, 1920, 1080);

    // the mark draws itself
    this.strokes.forEach((s, i) => {
      const k = smooth(inv(t, 0.6 + i * 0.55, 2.0 + i * 0.55));
      const len = Number(s.dataset.len);
      s.style.strokeDashoffset = String(len * (1 - k));
    });

    // illumination
    const glowK = smooth(inv(t, 3.2, 5.6));
    this.markWrap.style.filter = `drop-shadow(0 0 ${18 + 30 * glowK}px rgba(90,160,255,${0.25 + 0.45 * glowK}))`;
    const scaleK = smooth(inv(t, 3.2, 6.0));
    this.stack.style.transform = `scale(${lerp(0.985, 1, scaleK)})`;
    this.stack.style.opacity = String(1 - smooth(inv(t, 19.2, 19.9)));

    this.name.style.opacity = String(smooth(inv(t, 4.4, 6.2)));
    this.name.style.transform = `translateY(${(1 - smooth(inv(t, 4.4, 6.2))) * 14}px)`;
    this.os.style.opacity = String(smooth(inv(t, 6.0, 7.6)));
    this.promise.style.opacity = String(smooth(inv(t, 7.8, 9.6)));
    this.url.style.opacity = String(smooth(inv(t, 9.6, 11.4)));
    this.promise.style.transform = `translateY(${(1 - smooth(inv(t, 7.8, 9.6))) * 12}px)`;
    this.url.style.transform = `translateY(${(1 - smooth(inv(t, 9.6, 11.4))) * 12}px)`;

    // the sweep
    const sk = inv(t, 11.6, 13.6);
    this.sweep.style.opacity = String(sk > 0 && sk < 1 ? 0.9 : 0);
    this.sweep.style.left = `${lerp(-160, 200, sk)}px`;

    // a faint volumetric room so the black is not flat
    back.save();
    back.globalAlpha = 0.5;
    dustField(back, camera({ px: 0, py: 0, pz: 0, fov: 36 }), t, { count: 60, seed: 181, spread: 1200, focus: 1000, color: 'rgba(150,200,255,1)' });
    const g = back.createRadialGradient(960 * 2, 500 * 2, 0, 960 * 2, 500 * 2, 620 * 2);
    g.addColorStop(0, `rgba(60,120,220,${0.10 + 0.06 * glowK})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    back.fillStyle = g;
    back.fillRect(0, 0, 1920 * 2, 1080 * 2);
    back.restore();

    void front; void kf; void clamp; void sprite; void drawSprite; void addBlend;
  }
};
