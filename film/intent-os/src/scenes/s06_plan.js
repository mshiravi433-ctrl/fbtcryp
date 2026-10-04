/* SCENE 06 · 03:45–04:50 · FROM INTENT TO PLAN
   Everything the user gave, and everything the market gives, falls into one
   engine — and what comes out is a workflow, not a promise. The distinction
   is on screen: PROPOSED PLAN, never a guaranteed result. */
import { el, brandLockup } from '../lib/ui.js';
import { clamp, inv, smooth, kf, lerp, camera, dustField, sprite, drawSprite, addBlend, project, text, rng, TAU, room } from '../lib/fx.js';
import { vortex } from '../lib/kit.js';

const INPUTS = [
  ['GOAL', 'Portfolio growth'],
  ['RISK', 'Balanced'],
  ['TIME', '3 years'],
  ['PORTFOLIO', '$44,922 · 5 assets'],
  ['MARKET DATA', 'Live · 12 venues']
];
const STEPS = [
  'Analyze current portfolio',
  'Identify concentration',
  'Review market conditions',
  'Evaluate opportunities',
  'Define allocation framework',
  'Monitor risk'
];

export default {
  id: 'sc06',
  title: 'From Intent to Plan',
  t0: 225, t1: 290,

  build(env) {
    const root = el('div', { position: 'absolute', inset: '0', overflow: 'hidden' });
    
    const world = el('div', { position: 'absolute', inset: '0' });
    root.appendChild(world);

    const top = el('div', { position: 'absolute', top: '0', left: '0', right: '0', height: '74px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 46px', borderBottom: '1px solid rgba(255,255,255,.06)', background: 'rgba(6,10,18,.72)' });
    top.appendChild(brandLockup(22, { sub: 'INTENT SESSION' }));
    const hb = el('div', { display: 'flex', gap: '12px' });
    hb.appendChild(el('div', 'badge blue', '<span class="led"></span>ENGINE'));
    const st = el('div', 'badge', 'COMPILING');
    st.dataset.state = '';
    hb.appendChild(st);
    top.appendChild(hb);
    world.appendChild(top);

    // ── inputs that fall into the engine ───────────────────────────────
    const inputsRow = el('div', { position: 'absolute', left: '0', right: '0', top: '150px', display: 'flex', justifyContent: 'center', gap: '16px' });
    const cards = INPUTS.map(([k, v]) => {
      const c = el('div', 'card flat');
      c.style.cssText = 'padding:16px 18px;min-width:210px;opacity:0';
      c.innerHTML = `<div class="label">${k}</div><div style="font-size:17px;font-weight:600;margin-top:9px">${v}</div>`;
      inputsRow.appendChild(c);
      return c;
    });
    world.appendChild(inputsRow);
    this.inputsRow = inputsRow; this.cardsIn = cards;

    // ── the engine label ───────────────────────────────────────────────
    const engineLabel = el('div', { position: 'absolute', left: '50%', top: '430px', transform: 'translate(-50%,-50%)', textAlign: 'center', opacity: '0' });
    engineLabel.innerHTML = `<div class="kicker" style="letter-spacing:.42em">INTENT OS ENGINE</div>
      <div class="tiny" style="margin-top:14px">Structured reasoning · market context · portfolio constraints</div>`;
    world.appendChild(engineLabel);
    this.engineLabel = engineLabel;

    // ── the output ─────────────────────────────────────────────────────
    const out = el('div', 'card');
    out.style.cssText = 'position:absolute;left:50%;top:140px;transform:translateX(-50%);width:900px;padding:28px 30px;opacity:0';
    out.innerHTML = `<div class="row between">
        <div><div class="label">PROPOSED PLAN</div>
          <div style="font-size:24px;font-weight:700;letter-spacing:-.02em;margin-top:8px">Structured strategy · for your review</div></div>
        <div class="badge blue"><span class="led"></span>DRAFT · NOT EXECUTED</div>
      </div>
      <div style="margin-top:22px" data-steps></div>
      <div class="row between" style="margin-top:22px;padding-top:18px;border-top:1px solid rgba(255,255,255,.07)">
        <div class="tiny" style="max-width:560px">This is a proposed workflow, not a guaranteed result. Steps are shown so you can see how the decision was structured.</div>
        <div class="badge" style="border-color:rgba(255,180,87,.35);color:#ffb457">PROPOSED PLAN ≠ GUARANTEED RESULT</div>
      </div>`;
    world.appendChild(out);
    this.out = out;
    const stepEls = STEPS.map((s, i) => {
      const r = el('div', { display: 'flex', alignItems: 'center', gap: '15px', padding: '11px 0', borderBottom: i === STEPS.length - 1 ? 'none' : '1px solid rgba(255,255,255,.055)', opacity: '0' });
      r.innerHTML = `<span data-i style="width:26px;height:26px;border-radius:50%;border:1px solid rgba(255,255,255,.16);display:grid;place-items:center;font-family:'JetBrains Mono',monospace;font-size:11px;color:#93a3c4">${i + 1}</span>
        <span style="font-size:15.5px">${s}</span>
        <span data-tick style="margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:11px;color:#3b4761">QUEUED</span>`;
      out.querySelector('[data-steps]').appendChild(r);
      return r;
    });
    this.stepEls = stepEls;

    const cap = el('div', { position: 'absolute', left: '0', right: '0', bottom: '70px', textAlign: 'center', opacity: '0' });
    cap.innerHTML = `<div class="lead" style="max-width:880px;margin:0 auto;font-size:22px">The goal is not to predict the future with certainty.
      <strong>The goal is to make the decision process structured, transparent and informed.</strong></div>`;
    world.appendChild(cap);
    this.cap = cap;

    env.scenesEl.appendChild(root);
    Object.assign(this, { root, world, st });
    return root;
  },

  frame(t, env) {
    const { back, front } = env;
    back.setTransform(2, 0, 0, 2, 0, 0); back.clearRect(0, 0, 1920, 1080);
    room(back, { t, key: 'rgba(30,68,140,0.60)', keyY: 0.10 });
    front.setTransform(2, 0, 0, 2, 0, 0); front.clearRect(0, 0, 1920, 1080);

    // ── the engine, always present, growing as the inputs arrive ────────
    const engK = smooth(inv(t, 0.3, 2.0)) * (1 - smooth(inv(t, 46, 54)));
    const radius = kf(t, [[0, 120], [8, 300], [20, 430], [34, 470], [46, 430], [65, 380]]);
    back.save();
    back.globalAlpha = clamp(engK) * 0.95;
    vortex(back, 960, 560, t, { count: 1150, radius, alpha: 0.9 });
    back.restore();
    dustField(back, camera({ px: 0, py: 0, pz: 0, fov: 42 }), t, { count: 120, seed: 31, spread: 900, focus: 900, color: 'rgba(150,200,255,1)' });

    // ── inputs fall in ─────────────────────────────────────────────────
    const drop = smooth(inv(t, 0.8, 2.4));
    this.inputsRow.style.opacity = String(smooth(inv(t, 0.6, 1.6)) * (1 - smooth(inv(t, 8.6, 10.2))));
    this.cardsIn.forEach((c, i) => {
      const k = smooth(inv(t, 0.8 + i * 0.42, 2.2 + i * 0.42));
      const fall = smooth(inv(t, 9.0 + i * 0.16, 11.4 + i * 0.16));
      c.style.opacity = String(k);
      c.style.transform = `translateY(${(1 - k) * -18 + fall * 320}px) scale(${1 - 0.35 * fall})`;
      c.style.filter = `blur(${fall * 4}px)`;
      c.style.boxShadow = fall > 0.3 ? '0 0 40px rgba(60,120,255,.35)' : '';
    });
    this.engineLabel.style.opacity = String(smooth(inv(t, 3.0, 5.0)) * (1 - smooth(inv(t, 12, 15))));

    // ── inside the engine: the volume of data ──────────────────────────
    if (t > 11 && t < 50) {
      const k = smooth(inv(t, 11.5, 15)) * (1 - smooth(inv(t, 44, 50)));
      const r = rng(77);
      back.save();
      back.globalAlpha = k * 0.9;
      addBlend(back, true);
      for (let i = 0; i < 1500; i++) {
        const a = r() * TAU, rad = 120 + Math.pow(r(), 0.65) * (900 * k);
        const sp = 0.3 + r() * 0.7;
        const ang = a + t * sp;
        const px = 960 + Math.cos(ang) * rad * 1.35;
        const py = 560 + Math.sin(ang) * rad * 0.72;
        const s = 0.8 + r() * 2.4;
        back.globalAlpha = k * (0.10 + 0.35 * r());
        back.fillStyle = i % 5 === 0 ? 'rgba(150,140,255,0.95)' : 'rgba(120,180,255,0.95)';
        back.beginPath(); back.arc(px, py, s, 0, TAU); back.fill();
      }
      addBlend(back, false);
      back.restore();
      // streak lines pulling inward
      front.save();
      front.globalAlpha = k * 0.22;
      front.strokeStyle = 'rgba(150,200,255,0.6)';
      const r2 = rng(78);
      for (let i = 0; i < 90; i++) {
        const a = r2() * TAU;
        const r0 = 500 + r2() * 700, r1 = r0 - 220 * (0.4 + 0.6 * Math.sin(t * 0.9 + i));
        front.beginPath();
        front.moveTo(960 + Math.cos(a) * r0, 560 + Math.sin(a) * r0 * 0.6);
        front.lineTo(960 + Math.cos(a) * r1, 560 + Math.sin(a) * r1 * 0.6);
        front.stroke();
      }
      front.restore();
    }

    // ── 360° orbit around the engine ───────────────────────────────────
    if (t > 28 && t < 46) {
      const k = smooth(inv(t, 28, 32)) * (1 - smooth(inv(t, 42, 46)));
      const a = (t - 28) * 0.55; // radians
      const cam = camera({ px: Math.cos(a) * 260, py: 30, pz: -900 + Math.sin(a) * 160, yaw: -a * 0.6, fov: 44 });
      back.save();
      back.globalAlpha = k * 0.5;
      const pts = [];
      for (let i = 0; i < 8; i++) {
        const aa = (i / 8) * TAU + 0.4;
        pts.push({ x: 960 + Math.cos(aa) * 620, y: 560 + Math.sin(aa) * 300, label: '' });
      }
      // a ring of derived facts orbiting with the camera
      for (const p of pts) {
        const pr = project(cam, { x: (p.x - 960) * 1.0, y: (p.y - 560) * 1.0, z: 420 });
        if (!pr) continue;
        drawSprite(back, sprite('rgba(140,190,255,1)', 0.5), pr.x, pr.y, 60 * clamp(pr.s * 300, .3, 1.6), 0.35 * k);
      }
      back.restore();
    }

    // ── the structured strategy ────────────────────────────────────────
    const outK = smooth(inv(t, 16.5, 19.5));
    this.out.style.opacity = String(outK);
    this.out.style.transform = `translateX(-50%) translateY(${(1 - outK) * 26}px) scale(${lerp(0.97, 1, outK)})`;
    this.stepEls.forEach((s, i) => {
      const k = smooth(inv(t, 19.5 + i * 0.9, 21.2 + i * 0.9));
      s.style.opacity = String(k);
      s.style.transform = `translateX(${(1 - k) * 26}px)`;
      const tick = s.querySelector('[data-tick]');
      const done = i < 3;
      tick.textContent = k > 0.6 ? (done ? 'READY' : 'PENDING') : 'QUEUED';
      tick.style.color = k > 0.6 ? (done ? '#46d9a8' : '#ffb457') : '#3b4761';
    });
    this.cap.style.opacity = String(smooth(inv(t, 47, 50.5)));
    this.cap.style.transform = `translateY(${(1 - smooth(inv(t, 47, 50.5))) * 14}px)`;

    // engine status
    const structK = smooth(inv(t, 17.5, 18.6));
    this.st.innerHTML = structK > 0.5 ? '<span class="led" style="background:#46d9a8"></span>STRUCTURED' : '<span class="led"></span>COMPILING';
    this.st.className = 'badge' + (structK > 0.5 ? ' mint' : '');

    // the engine core breathes under the plan
    if (t > 46) {
      back.save();
      back.globalAlpha = 0.18 * (1 - smooth(inv(t, 60, 65)));
      vortex(back, 960, 900, t, { count: 420, radius: 300, alpha: 0.8 });
      back.restore();
    }
    void text; (void 0);
  }
};
